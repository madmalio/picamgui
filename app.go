package main

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// CameraSettings matches the React state
type CameraSettings struct {
	FPS         float64 `json:"fps"`
	Shutter     string  `json:"shutter"`
	ISO         int     `json:"iso"`
	WB          string  `json:"wb"`
	Resolution  string  `json:"resolution"`
	Codec       string  `json:"codec"`
	Denoise     string  `json:"denoise"`
	Anamorphic  string  `json:"anamorphic"`
	ShutterMode string  `json:"shutterMode"`
	Metering    string  `json:"metering"`
	Flicker     string  `json:"flicker"`
	Sharpness   float64 `json:"sharpness"`
	Contrast    float64 `json:"contrast"`
	Saturation  float64 `json:"saturation"`
	Bitrate     int     `json:"bitrate"`
	Kelvin      int     `json:"kelvin"`
	AudioGain   int     `json:"audioGain"` // 0 to 100
	Peaking     bool    `json:"peaking"`
	Zebras      bool    `json:"zebras"`
	FalseColor  bool    `json:"falseColor"`
}

type FileInfo struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	Date string `json:"date"`
}

// SystemStats for telemetry
type SystemStats struct {
	CPUTemp     float64   `json:"cpuTemp"`
	Voltage     float64   `json:"voltage"`
	DiskFree    uint64    `json:"diskFree"` // in bytes
	DiskTotal   uint64    `json:"diskTotal"`
	MemoryFree  float64   `json:"memoryFree"` // in GB
	IsThrottled bool      `json:"isThrottled"`
	AudioLevels []float64 `json:"audioLevels"` // Left and Right channels, 0.0 to 1.0
	Histogram   []int     `json:"histogram"`   // 256 bins for luminance
}

// App struct
type App struct {
	ctx          context.Context
	settings     CameraSettings
	settingsLock sync.Mutex
	frameReady   chan []byte
	isRecording  bool
	recordStart  time.Time
	lumBuffer    []int
	bufferLock   sync.Mutex
	histogram    []int
	cmd          *exec.Cmd
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		frameReady: make(chan []byte, 1),
		histogram:  make([]int, 256),
		settings: CameraSettings{
			FPS:         24,
			ISO:         800,
			Shutter:     "1/48",
			ShutterMode: "180",
			WB:          "Daylight",
			Resolution:  "1080p",
			Codec:       "H.264 (HW)",
			Bitrate:     25,
			Kelvin:      5600,
			AudioGain:   50,
			Metering:    "Matrix",
			Flicker:     "Off",
			Sharpness:   1.0,
			Contrast:    1.0,
			Saturation:  1.0,
		},
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.startStreamServer()

	if runtime.GOOS == "linux" {
		go a.startProductionStream()
	} else {
		go a.generateMockFrames()
	}
}

// startProductionStream interfaces with libcamera-vid (rpicam-vid)
func (a *App) startProductionStream() {
	for {
		a.settingsLock.Lock()
		fps := a.settings.FPS
		iso := a.settings.ISO
		shutter := a.settings.Shutter
		wb := a.settings.WB
		_ = a.settings.Kelvin // Reserved for future manual WB logic
		a.settingsLock.Unlock()

		shutterMicros := 0
		var num, den int
		if n, err := fmt.Sscanf(shutter, "%d/%d", &num, &den); err == nil && n == 2 {
			shutterMicros = int((float64(num) / float64(den)) * 1000000)
		}

		args := []string{
			"-n", "-t", "0",
			"--inline",
			"--codec", "mjpeg",
			"--width", "1280",
			"--height", "720",
			"--framerate", fmt.Sprintf("%f", fps),
			"-o", "-",
		}

		// WB Mapping
		awbMode := "auto"
		switch wb {
		case "Daylight":
			awbMode = "daylight"
		case "Cloudy":
			awbMode = "cloudy"
		case "Tungsten":
			awbMode = "tungsten"
		case "Fluorescent":
			awbMode = "fluorescent"
		case "Incandescent":
			awbMode = "incandescent"
		case "Manual":
			awbMode = "manual"
		}
		args = append(args, "--awb", awbMode)

		if wb == "Manual" {
			// Very rough Kelvin to RGB gains approximation
			// For a real app, use a proper table or libcamera's color temperature support if available
			// rpicam-vid doesn't have a direct Kelvin flag, but we can use --awbgains
			args = append(args, "--awbgains", "1.5,1.5") // Placeholder
		}

		if iso > 0 {
			args = append(args, "--gain", fmt.Sprintf("%f", float64(iso)/100.0))
		}
		if shutterMicros > 0 {
			args = append(args, "--shutter", fmt.Sprintf("%d", shutterMicros))
		}

		cmd := exec.Command("rpicam-vid", args...)
		a.cmd = cmd
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			fmt.Printf("Error creating stdout pipe: %v\n", err)
			time.Sleep(time.Second)
			continue
		}

		if err := cmd.Start(); err != nil {
			fmt.Printf("Error starting rpicam-vid: %v\n", err)
			time.Sleep(time.Second)
			continue
		}

		// Buffer to store frame data
		buffer := make([]byte, 1024*1024)
		frame := new(bytes.Buffer)

		for {
			n, err := stdout.Read(buffer)
			if err != nil {
				// Command likely killed or crashed
				break
			}

			data := buffer[:n]
			for i := 0; i < len(data); i++ {
				if i < len(data)-1 && data[i] == 0xFF && data[i+1] == 0xD8 {
					frame.Reset()
				}
				frame.WriteByte(data[i])

				if i > 0 && data[i-1] == 0xFF && data[i] == 0xD9 {
					rawFrame := frame.Bytes()

					a.settingsLock.Lock()
					peaking := a.settings.Peaking
					a.settingsLock.Unlock()

					if peaking {
						img, err := jpeg.Decode(bytes.NewReader(rawFrame))
						if err == nil {
							rgba, ok := img.(*image.RGBA)
							if !ok {
								bounds := img.Bounds()
								rgba = image.NewRGBA(bounds)
								draw.Draw(rgba, bounds, img, bounds.Min, draw.Src)
							}

							a.bufferLock.Lock()
							w, h := rgba.Bounds().Dx(), rgba.Bounds().Dy()
							if len(a.lumBuffer) < w*h {
								a.lumBuffer = make([]int, w*h)
							}
							ApplyFocusPeaking(rgba, a.lumBuffer, a.histogram)
							a.bufferLock.Unlock()

							var b bytes.Buffer
							jpeg.Encode(&b, rgba, &jpeg.Options{Quality: 75})
							rawFrame = b.Bytes()
						}
					}

					select {
					case a.frameReady <- rawFrame:
					default:
					}
				}
			}
		}
		cmd.Wait()
		fmt.Println("Camera process exited, restarting...")
		time.Sleep(time.Millisecond * 100)
	}
}

// startStreamServer runs a small HTTP server for the MJPEG stream
func (a *App) startStreamServer() {
	http.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		m := multipart.NewWriter(w)
		w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+m.Boundary())

		for {
			select {
			case frame := <-a.frameReady:
				header := make(textproto.MIMEHeader)
				header.Set("Content-Type", "image/jpeg")
				header.Set("Content-Length", fmt.Sprintf("%d", len(frame)))

				mw, err := m.CreatePart(header)
				if err != nil {
					return
				}

				_, err = mw.Write(frame)
				if err != nil {
					return
				}
			case <-r.Context().Done():
				return
			}
		}
	})

	server := &http.Server{Addr: ":8081"}
	if err := server.ListenAndServe(); err != nil {
		fmt.Printf("Stream server error: %v\n", err)
	}
}

// generateMockFrames simulates camera output
func (a *App) generateMockFrames() {
	width, height := 1280, 720
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	tick := time.NewTicker(time.Millisecond * 41)
	defer tick.Stop()

	counter := 0
	for range tick.C {
		counter++

		// Render dynamic test pattern
		bgColor := color.RGBA{12, 12, 14, 255}
		if a.isRecording {
			// Subtle red tint when recording
			bgColor = color.RGBA{20, 10, 10, 255}
		}
		draw.Draw(img, img.Bounds(), &image.Uniform{bgColor}, image.Point{}, draw.Src)

		xPos := (counter * 8) % width
		draw.Draw(img, image.Rect(xPos, 0, xPos+40, height), &image.Uniform{color.RGBA{14, 165, 233, 80}}, image.Point{}, draw.Over)

		// Grid
		for i := 0; i < width; i += 160 {
			draw.Draw(img, image.Rect(i, 0, i+1, height), &image.Uniform{color.RGBA{255, 255, 255, 15}}, image.Point{}, draw.Over)
		}

		// Real Edge Detection Focus Peaking
		if a.settings.Peaking {
			a.bufferLock.Lock()
			if len(a.lumBuffer) < width*height {
				a.lumBuffer = make([]int, width*height)
			}
			ApplyFocusPeaking(img, a.lumBuffer, a.histogram)
			a.bufferLock.Unlock()
		}

		var b bytes.Buffer
		jpeg.Encode(&b, img, &jpeg.Options{Quality: 75})

		select {
		case a.frameReady <- b.Bytes():
		default:
		}
	}
}

// GetSystemStats returns real or mock telemetry
func (a *App) GetSystemStats() SystemStats {
	var stats SystemStats
	a.bufferLock.Lock()
	stats.Histogram = make([]int, 256)
	copy(stats.Histogram, a.histogram)
	a.bufferLock.Unlock()

	if runtime.GOOS == "windows" {
		stats = SystemStats{
			CPUTemp:     42.5,
			Voltage:     5.0,
			DiskFree:    500 * 1024 * 1024 * 1024,
			DiskTotal:   1024 * 1024 * 1024 * 1024,
			MemoryFree:  1.4,
			IsThrottled: false,
		}
	} else {
		// Real Linux logic (simplified for Pi)
		d, _ := disk.Usage("/")
		stats.DiskFree = d.Free
		stats.DiskTotal = d.Total

		// Temperature (Pi specific)
		data, err := os.ReadFile("/sys/class/thermal/thermal_zone0/temp")
		if err == nil {
			var rawTemp int
			fmt.Sscanf(string(data), "%d", &rawTemp)
			stats.CPUTemp = float64(rawTemp) / 1000.0
		}

		stats.Voltage = 5.05
		stats.MemoryFree = 1.2
	}

	return stats
}

// GetAudioLevels returns mock audio levels for VU meters
func (a *App) GetAudioLevels() []float64 {
	// Mock random levels between 0.2 and 0.8
	return []float64{
		0.2 + rand.Float64()*0.6,
		0.2 + rand.Float64()*0.6,
	}
}

// ToggleRecording handles the record button
func (a *App) ToggleRecording() bool {
	a.isRecording = !a.isRecording
	if a.isRecording {
		a.recordStart = time.Now()
		fmt.Println("Recording Started")
		// MOCK: Create a dummy file
		if runtime.GOOS == "windows" {
			os.MkdirAll("captures", 0755)
			fname := fmt.Sprintf("CLIP_%s.mp4", a.recordStart.Format("20060102_150405"))
			os.WriteFile(filepath.Join("captures", fname), []byte("dummy video data"), 0644)
		}
	} else {
		fmt.Printf("Recording Stopped. Duration: %v\n", time.Since(a.recordStart))
	}
	return a.isRecording
}

// UpdateConfig is called from the frontend
func (a *App) UpdateConfig(settings CameraSettings) {
	a.settingsLock.Lock()
	oldFPS := a.settings.FPS
	oldISO := a.settings.ISO
	oldShutter := a.settings.Shutter
	oldWB := a.settings.WB
	oldKelvin := a.settings.Kelvin
	a.settings = settings
	a.settingsLock.Unlock()

	fmt.Printf("Camera Hardware Config Updated: FPS:%v ISO:%v SHUT:%s WB:%s Kelvin:%v\n", settings.FPS, settings.ISO, settings.Shutter, settings.WB, settings.Kelvin)

	// Restart camera if hardware settings changed and we are on Linux
	if runtime.GOOS == "linux" {
		if settings.FPS != oldFPS || settings.ISO != oldISO || settings.Shutter != oldShutter || settings.WB != oldWB || settings.Kelvin != oldKelvin {
			if a.cmd != nil && a.cmd.Process != nil {
				a.cmd.Process.Kill()
			}
		}
	}
}

// ListCaptures returns files in the captures directory
func (a *App) ListCaptures() []FileInfo {
	var files []FileInfo
	entries, err := os.ReadDir("captures")
	if err != nil {
		return files
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			files = append(files, FileInfo{
				Name: entry.Name(),
				Size: info.Size(),
				Date: info.ModTime().Format("2006-01-02 15:04"),
			})
		}
	}
	return files
}

// DeleteCapture deletes a file
func (a *App) DeleteCapture(name string) bool {
	err := os.Remove(filepath.Join("captures", name))
	return err == nil
}

// GetOS returns the current operating system
func (a *App) GetOS() string {
	return runtime.GOOS
}
