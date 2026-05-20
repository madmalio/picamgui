package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"io/fs"
	"math"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v3/disk"
)

// CameraSettings matches the React state
type CameraSettings struct {
	FPS              float64 `json:"fps"`
	TimecodeMode     string  `json:"timecodeMode"`
	TimecodeFrames   int64   `json:"timecodeFrames"`
	Shutter          string  `json:"shutter"`
	ISO              int     `json:"iso"`
	WB               string  `json:"wb"`
	Resolution       string  `json:"resolution"`
	RecordResolution string  `json:"recordResolution"`
	Codec            string  `json:"codec"`
	Denoise          string  `json:"denoise"`
	Anamorphic       string  `json:"anamorphic"`
	ShutterMode      string  `json:"shutterMode"`
	Metering         string  `json:"metering"`
	Flicker          string  `json:"flicker"`
	Sharpness        float64 `json:"sharpness"`
	Contrast         float64 `json:"contrast"`
	Saturation       float64 `json:"saturation"`
	Bitrate          int     `json:"bitrate"`
	Kelvin           int     `json:"kelvin"`
	AudioGain        int     `json:"audioGain"` // 0 to 100
	AudioEnabled     bool    `json:"audioEnabled"`
	AudioDevice      string  `json:"audioDevice"`
	AudioFormat      string  `json:"audioFormat"`
	Tint             string  `json:"tint"`
	Container        string  `json:"container"` // "MP4" or "MKV"
	PreviewMode      string  `json:"previewMode"`
	Peaking          bool    `json:"peaking"`
	PeakingMono      bool    `json:"peakingMono"`
	Zebras           bool    `json:"zebras"`
	FalseColor       bool    `json:"falseColor"`
	Histogram        bool    `json:"histogram"`
	Grid             bool    `json:"grid"`
	AutoHotspot      bool    `json:"autoHotspot"`
	HotspotSSID      string  `json:"hotspotSSID"`
	HotspotPassword  string  `json:"hotspotPassword"`
	StreamEnabled    bool    `json:"streamEnabled"`
	StreamAudio      bool    `json:"streamAudio"`
	StreamPath       string  `json:"streamPath"`
	StreamResolution string  `json:"streamResolution"`
}

type FileInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	Date      string `json:"date"`
	Thumbnail string `json:"thumbnail"`
	Extension string `json:"extension"`
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

type WifiNetwork struct {
	SSID     string `json:"ssid"`
	Signal   int    `json:"signal"`
	Security string `json:"security"`
	InUse    bool   `json:"inUse"`
}

type WifiStatus struct {
	Supported bool   `json:"supported"`
	Connected bool   `json:"connected"`
	SSID      string `json:"ssid"`
	Device    string `json:"device"`
	IP        string `json:"ip"`
	Error     string `json:"error"`
	Mode      string `json:"mode"`
	Hotspot   bool   `json:"hotspot"`
}

type AudioDeviceInfo struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// App struct
type App struct {
	ctx             context.Context
	assets          embed.FS
	settings        CameraSettings
	settingsLock    sync.Mutex
	frameReady      chan []byte
	listeners       []chan []byte
	listenersMu     sync.Mutex
	isRecording     bool
	recordStart     time.Time
	lumBuffer       []int
	bufferLock      sync.Mutex
	histogram       []int
	cmd             *exec.Cmd
	cmdMu           sync.Mutex
	recordPipe      io.WriteCloser
	recordCmd       *exec.Cmd
	recordPath      string
	recordFinalPath string
	recordChan      chan []byte
	recordStopCh    chan struct{}
	recordDoneCh    chan struct{}
	recordProcDone  chan struct{}
	audioRecordCmd  *exec.Cmd
	audioRecordPath string
	audioMuxEnabled bool
	audioProcDone   chan struct{}
	streamMu        sync.Mutex
	streamPipe      io.WriteCloser
	streamCmd       *exec.Cmd
	streamChan      chan []byte
	streamStop      bool
	streamAudioOn   bool
	mtxMu           sync.Mutex
	mtxCmd          *exec.Cmd
	lastOverlay     []byte
	latestFrame     []byte
	latestFrameMu   sync.RWMutex
	server          *http.Server
	stopCh          chan struct{}
	shutdownOnce    sync.Once
	recordFrames    int64
	recordAudioOn   bool
	recordRetry     bool
	audioLevelMu    sync.Mutex
	audioLevelTS    time.Time
	audioLevelVal   []float64
	audioCaptureMu  sync.Mutex
}

var enableMediaMTXPublisher = os.Getenv("PICAM_ENABLE_PUBLISHER") == "1"

// NewApp creates a new App application struct
func NewApp(assets embed.FS) *App {
	return &App{
		assets:     assets,
		frameReady: make(chan []byte, 1),
		histogram:  make([]int, 256),
		recordChan: make(chan []byte, 1000), // Increased buffer for stability
		streamChan: make(chan []byte, 4),    // Keep tiny for low-latency WebRTC publishing
		stopCh:     make(chan struct{}),
		settings: CameraSettings{
			FPS:              24,
			TimecodeMode:     "recordRun",
			TimecodeFrames:   0,
			ISO:              800,
			Shutter:          "1/48",
			ShutterMode:      "180",
			WB:               "Daylight",
			Resolution:       "1080p",
			RecordResolution: "1080p",
			Codec:            "H.264 (HW)",
			Bitrate:          25,
			Kelvin:           5600,
			Tint:             "0",
			Container:        "MP4",
			PreviewMode:      "control",
			AudioGain:        50,
			AudioEnabled:     false,
			AudioDevice:      "hw:1,0",
			AudioFormat:      "AAC",
			Metering:         "Matrix",
			Flicker:          "Off",
			Sharpness:        1.0,
			Contrast:         1.0,
			Saturation:       1.0,
			Histogram:        true,
			Grid:             false,
			AutoHotspot:      true,
			StreamEnabled:    false,
			StreamAudio:      true,
			StreamPath:       "picam",
			StreamResolution: "1080p",
		},
	}
}

func (a *App) isStopping() bool {
	select {
	case <-a.stopCh:
		return true
	default:
		return false
	}
}

func configureCmd(cmd *exec.Cmd) {
	_ = cmd
}

func cleanupOrphanProcesses() {
	if runtime.GOOS != "linux" {
		return
	}

	_ = exec.Command("pkill", "-9", "-f", "rpicam-vid").Run()
	_ = exec.Command("pkill", "-9", "-f", "ffmpeg").Run()
}

func terminateCmd(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}

	pid := cmd.Process.Pid

	if runtime.GOOS == "linux" {
		// Try graceful stop first.
		_ = cmd.Process.Signal(os.Interrupt)
		time.Sleep(120 * time.Millisecond)

		// Kill child processes spawned by this command.
		_ = exec.Command("pkill", "-TERM", "-P", fmt.Sprintf("%d", pid)).Run()
		_ = exec.Command("kill", "-TERM", fmt.Sprintf("%d", pid)).Run()
		time.Sleep(120 * time.Millisecond)

		// Force kill remaining descendants and parent.
		_ = exec.Command("pkill", "-KILL", "-P", fmt.Sprintf("%d", pid)).Run()
		_ = exec.Command("kill", "-KILL", fmt.Sprintf("%d", pid)).Run()
	} else {
		_ = cmd.Process.Kill()
	}

	_ = cmd.Wait()
}

func nmcliSupported() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	_, err := exec.LookPath("nmcli")
	return err == nil
}

func runNmcli(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "nmcli", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("nmcli %v failed: %w (%s)", args, err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func splitNmcliEscaped(s string, maxFields int) []string {
	if maxFields <= 1 {
		return []string{s}
	}

	parts := make([]string, 0, maxFields)
	var b strings.Builder
	escaped := false

	for _, r := range s {
		if escaped {
			b.WriteRune(r)
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == ':' && len(parts) < maxFields-1 {
			parts = append(parts, b.String())
			b.Reset()
			continue
		}
		b.WriteRune(r)
	}
	parts = append(parts, b.String())

	for len(parts) < maxFields {
		parts = append(parts, "")
	}
	return parts
}

func normalizeWifiSSID(raw string) string {
	ssid := strings.TrimSpace(raw)
	if ssid == "" {
		return ssid
	}

	// Netplan-generated profile names often look like:
	// netplan-wlan0-MyNetwork
	if strings.HasPrefix(ssid, "netplan-") {
		parts := strings.SplitN(ssid, "-", 3)
		if len(parts) == 3 && strings.TrimSpace(parts[2]) != "" {
			return strings.TrimSpace(parts[2])
		}
	}

	return ssid
}

func normalizeCameraSettings(s CameraSettings) CameraSettings {
	if s.TimecodeMode == "" {
		s.TimecodeMode = "recordRun"
	}
	if s.Resolution != "720p" && s.Resolution != "1080p" {
		s.Resolution = "1080p"
	}
	if s.RecordResolution == "" {
		s.RecordResolution = s.Resolution
		if s.RecordResolution == "" {
			s.RecordResolution = "1080p"
		}
	}
	if s.RecordResolution != "720p" && s.RecordResolution != "1080p" {
		s.RecordResolution = "1080p"
	}
	if s.PreviewMode == "" {
		s.PreviewMode = "control"
	}
	if s.FPS <= 0 {
		s.FPS = 24
	}
	if strings.TrimSpace(s.AudioDevice) == "" {
		s.AudioDevice = "plughw:1,0"
	}
	if s.AudioFormat != "AAC" && s.AudioFormat != "32-bit Float" {
		s.AudioFormat = "AAC"
	}
	if s.Resolution == "1080p" && s.FPS > 30 {
		s.FPS = 30
	}
	if strings.TrimSpace(s.StreamPath) == "" {
		s.StreamPath = "picam"
	}
	if s.StreamResolution != "1080p" {
		s.StreamResolution = "1080p"
	}
	if strings.TrimSpace(s.HotspotSSID) == "" {
		if !s.AutoHotspot {
			// Legacy settings files won't include autoHotspot; default on for recovery.
			s.AutoHotspot = true
		}
		host, _ := os.Hostname()
		host = strings.TrimSpace(host)
		suffix := host
		if len(suffix) > 4 {
			suffix = suffix[len(suffix)-4:]
		}
		suffix = strings.ToUpper(strings.ReplaceAll(suffix, " ", ""))
		if suffix == "" {
			suffix = "PI"
		}
		s.HotspotSSID = "PiCam-" + suffix
	}
	if strings.TrimSpace(s.HotspotPassword) == "" || len(strings.TrimSpace(s.HotspotPassword)) < 8 {
		s.HotspotPassword = defaultHotspotPassword()
	}
	return s
}

func defaultHotspotPassword() string {
	host, _ := os.Hostname()
	host = strings.TrimSpace(strings.ToUpper(host))
	if len(host) > 4 {
		host = host[len(host)-4:]
	}
	host = strings.ReplaceAll(host, " ", "")
	if host == "" {
		host = "PICAM"
	}
	return "picam-" + host + "-01"
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.LoadSettings()
	go a.startStreamServer()
	go a.monitorAutoHotspotFallback()

	if runtime.GOOS == "linux" {
		cleanupOrphanProcesses()
		time.Sleep(300 * time.Millisecond)

		if enableMediaMTXPublisher {
			go a.monitorMediaMTXPublisher()
			go a.startMediaMTXPublisher()
		}
		go a.startProductionStream()
	} else {
		go a.generateMockFrames()
	}
}

func (a *App) isStreamingRequested() bool {
	a.settingsLock.Lock()
	defer a.settingsLock.Unlock()
	return a.settings.StreamEnabled
}

func (a *App) getStreamPath() string {
	a.settingsLock.Lock()
	defer a.settingsLock.Unlock()
	path := strings.TrimSpace(a.settings.StreamPath)
	if path == "" {
		return "picam"
	}
	return path
}

// startProductionStream interfaces with libcamera-vid (rpicam-vid)
func (a *App) startProductionStream() {
	for {
		if a.isStopping() {
			return
		}

		a.settingsLock.Lock()
		fps := a.settings.FPS
		iso := a.settings.ISO
		shutter := a.settings.Shutter
		wb := a.settings.WB
		res := a.settings.Resolution
		_ = a.settings.Kelvin // Reserved for future manual WB logic
		a.settingsLock.Unlock()

		shutterMicros := 0
		var num, den int
		if n, err := fmt.Sscanf(shutter, "%d/%d", &num, &den); err == nil && n == 2 {
			shutterMicros = int((float64(num) / float64(den)) * 1000000)
		}

		width, height := "1280", "720"
		if res == "1080p" {
			width, height = "1920", "1080"
		} else if res == "2K" {
			width, height = "2048", "1080"
		} else if res == "4K" {
			width, height = "3840", "2160"
		}

		args := []string{
			"-n", "-t", "0",
			"--inline",
			"--buffer-count", "1",
			"--codec", "mjpeg",
			"--width", width,
			"--height", height,
			"--framerate", fmt.Sprintf("%f", fps),
			"--quality", "70",
			"-o", "-",
		}

		// WB Mapping
		if wb == "Manual" {
			// For manual WB, we set gains. In rpicam-apps, this typically overrides AWB.
			// Simple Kelvin to RGB gains approximation
			r, b := kelvinToGains(a.settings.Kelvin)
			args = append(args, "--awbgains", fmt.Sprintf("%.2f,%.2f", r, b))
		} else {
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
			}
			args = append(args, "--awb", awbMode)
		}

		if iso > 0 {
			args = append(args, "--gain", fmt.Sprintf("%f", float64(iso)/100.0))
		}
		if shutterMicros > 0 {
			args = append(args, "--shutter", fmt.Sprintf("%d", shutterMicros))
		}

		cmd := exec.Command("rpicam-vid", args...)
		configureCmd(cmd)
		a.cmdMu.Lock()
		a.cmd = cmd
		a.cmdMu.Unlock()

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
		fmt.Printf("Camera started with PID: %d\n", cmd.Process.Pid)
		fmt.Printf("Camera source active: %sx%s @ %.0ffps\n", width, height, fps)

		scanner := bufio.NewReaderSize(stdout, 1024*1024)
		counter := 0
		previewMinInterval := time.Second / 20
		lastPreviewPush := time.Now().Add(-previewMinInterval)
		for {
			if a.isStopping() {
				terminateCmd(cmd)
				return
			}

			_, err := scanner.ReadSlice(0xFF)
			if err != nil {
				break
			}

			nextByte, err := scanner.ReadByte()
			if err != nil {
				break
			}

			if nextByte != 0xD8 {
				continue
			}

			frame := new(bytes.Buffer)
			frame.WriteByte(0xFF)
			frame.WriteByte(0xD8)

			for {
				data, err := scanner.ReadSlice(0xFF)
				if err != nil {
					goto restart_camera
				}
				frame.Write(data)

				nextByte, err := scanner.ReadByte()
				if err != nil {
					goto restart_camera
				}
				frame.WriteByte(nextByte)

				if nextByte == 0xD9 {
					break
				}
			}

			rawFrame := frame.Bytes()

			if runtime.GOOS == "linux" && enableMediaMTXPublisher {
				select {
				case a.streamChan <- rawFrame:
				default:
					// Keep camera loop real-time under pressure
				}
			}

			a.settingsLock.Lock()
			mSettings := MonitoringSettings{
				Peaking:    a.settings.Peaking,
				Zebras:     a.settings.Zebras,
				FalseColor: a.settings.FalseColor,
				Histogram:  a.settings.Histogram,
			}
			a.settingsLock.Unlock()

			// Check if we should process
			a.bufferLock.Lock()
			counter++
			heavyOverlays := mSettings.Peaking || mSettings.Zebras || mSettings.FalseColor
			processEvery := 1
			if mSettings.FalseColor {
				processEvery = 4
			} else if heavyOverlays {
				processEvery = 2
			} else if mSettings.Histogram {
				processEvery = 4
			}
			shouldProcess := counter%processEvery == 0

			previewFrame := rawFrame // Clean frame by default
			if heavyOverlays && len(a.lastOverlay) > 0 {
				previewFrame = a.lastOverlay
			}

			if shouldProcess {
				img, err := jpeg.Decode(bytes.NewReader(rawFrame))
				if err == nil {
					rgba, ok := img.(*image.RGBA)
					if !ok {
						bounds := img.Bounds()
						rgba = image.NewRGBA(bounds)
						draw.Draw(rgba, bounds, img, bounds.Min, draw.Src)
					}

					w, h := rgba.Bounds().Dx(), rgba.Bounds().Dy()
					if len(a.lumBuffer) < w*h {
						a.lumBuffer = make([]int, w*h)
					}

					ProcessImage(rgba, mSettings, a.lumBuffer, a.histogram, counter)

					// Only re-encode if we modified the image for preview
					if heavyOverlays {
						var b bytes.Buffer
						jpeg.Encode(&b, rgba, &jpeg.Options{Quality: 26})
						previewFrame = b.Bytes()
						a.lastOverlay = append(a.lastOverlay[:0], previewFrame...)
					}
				}
			}
			a.bufferLock.Unlock()

			now := time.Now()
			if now.Sub(lastPreviewPush) >= previewMinInterval {
				a.latestFrameMu.Lock()
				a.latestFrame = append(a.latestFrame[:0], previewFrame...)
				a.latestFrameMu.Unlock()
				a.broadcastFrame(previewFrame)
				lastPreviewPush = now
			}

			// Recording Tap (Clean stream)
			if a.isRecording {
				recFrame := append([]byte(nil), rawFrame...)
				select {
				case a.recordChan <- recFrame:
				default:
					// Buffer full, skip frame to keep preview fluid
					fmt.Println("Warning: Recording buffer full, dropping frame")
				}
			}

		}

	restart_camera:
		if a.isStopping() {
			terminateCmd(cmd)
			return
		}
		terminateCmd(cmd)
		fmt.Println("Camera process exited, restarting...")
		time.Sleep(time.Millisecond * 100)
	}
}

// startStreamServer runs a small HTTP server for the MJPEG stream
func (a *App) startStreamServer() {
	// This was on 8081, but headless server handles it on 8080/stream now
}

// broadcastFrame sends the frame to all connected listeners
func (a *App) broadcastFrame(frame []byte) {
	a.listenersMu.Lock()
	defer a.listenersMu.Unlock()
	for _, listener := range a.listeners {
		select {
		case listener <- frame:
		default:
			// Keep latest-frame semantics: discard stale queued frame
			// and replace it with the newest one to avoid lag buildup.
			select {
			case <-listener:
			default:
			}
			select {
			case listener <- frame:
			default:
			}
		}
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

		bgColor := color.RGBA{12, 12, 14, 255}
		if a.isRecording {
			bgColor = color.RGBA{20, 10, 10, 255}
		}
		draw.Draw(img, img.Bounds(), &image.Uniform{bgColor}, image.Point{}, draw.Src)

		xPos := (counter * 8) % width
		draw.Draw(img, image.Rect(xPos, 0, xPos+40, height), &image.Uniform{color.RGBA{14, 165, 233, 80}}, image.Point{}, draw.Over)

		for i := 0; i < width; i += 160 {
			draw.Draw(img, image.Rect(i, 0, i+1, height), &image.Uniform{color.RGBA{255, 255, 255, 15}}, image.Point{}, draw.Over)
		}

		a.settingsLock.Lock()
		mSettings := MonitoringSettings{
			Peaking:    a.settings.Peaking,
			Zebras:     a.settings.Zebras,
			FalseColor: a.settings.FalseColor,
			Histogram:  true,
		}
		a.settingsLock.Unlock()

		// Always update for mock
		a.bufferLock.Lock()
		if len(a.lumBuffer) < width*height {
			a.lumBuffer = make([]int, width*height)
		}
		ProcessImage(img, mSettings, a.lumBuffer, a.histogram, counter)
		a.bufferLock.Unlock()

		var b bytes.Buffer
		jpeg.Encode(&b, img, &jpeg.Options{Quality: 75})

		a.broadcastFrame(b.Bytes())
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
		d, _ := disk.Usage("/")
		stats.DiskFree = d.Free
		stats.DiskTotal = d.Total

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

// GetAudioLevels returns live (Linux) or mock (Windows) VU levels
func (a *App) GetAudioLevels() []float64 {
	if runtime.GOOS == "linux" {
		a.streamMu.Lock()
		streamingWithAudio := a.streamAudioOn
		a.streamMu.Unlock()
		if streamingWithAudio {
			// Avoid ALSA capture contention while stream publisher owns input device.
			a.audioLevelMu.Lock()
			if len(a.audioLevelVal) == 2 {
				cached := []float64{a.audioLevelVal[0], a.audioLevelVal[1]}
				a.audioLevelMu.Unlock()
				return cached
			}
			a.audioLevelMu.Unlock()
			return []float64{0, 0}
		}

		if a.isRecording {
			a.audioLevelMu.Lock()
			if len(a.audioLevelVal) == 2 {
				cached := []float64{a.audioLevelVal[0], a.audioLevelVal[1]}
				a.audioLevelMu.Unlock()
				return cached
			}
			a.audioLevelMu.Unlock()
			return []float64{0, 0}
		}

		a.audioLevelMu.Lock()
		if time.Since(a.audioLevelTS) < 180*time.Millisecond && len(a.audioLevelVal) == 2 {
			cached := []float64{a.audioLevelVal[0], a.audioLevelVal[1]}
			a.audioLevelMu.Unlock()
			return cached
		}
		a.audioLevelMu.Unlock()

		a.settingsLock.Lock()
		device := a.settings.AudioDevice
		a.settingsLock.Unlock()
		if strings.TrimSpace(device) == "" {
			device = "plughw:1,0"
		}

		ctx, cancel := context.WithTimeout(context.Background(), 450*time.Millisecond)
		defer cancel()
		a.audioCaptureMu.Lock()
		defer a.audioCaptureMu.Unlock()
		cmd := exec.CommandContext(ctx,
			"arecord",
			"-D", device,
			"-f", "S16_LE",
			"-c", "2",
			"-r", "48000",
			"--samples=4800",
			"-t", "raw",
			"-q",
		)
		raw, err := cmd.Output()
		if err == nil && len(raw) >= 4 {
			var peakL int16
			var peakR int16
			for i := 0; i+3 < len(raw); i += 4 {
				l := int16(binary.LittleEndian.Uint16(raw[i : i+2]))
				r := int16(binary.LittleEndian.Uint16(raw[i+2 : i+4]))
				if abs16(l) > abs16(peakL) {
					peakL = l
				}
				if abs16(r) > abs16(peakR) {
					peakR = r
				}
			}

			rawLevels := []float64{
				meterLevelFromPCM16Peak(peakL),
				meterLevelFromPCM16Peak(peakR),
			}
			a.audioLevelMu.Lock()
			levels := smoothMeterLevels(a.audioLevelVal, rawLevels, 0.85, 0.18)
			a.audioLevelTS = time.Now()
			a.audioLevelVal = levels
			a.audioLevelMu.Unlock()
			return levels
		}

		return []float64{0, 0}
	}

	return []float64{
		0.2 + rand.Float64()*0.6,
		0.2 + rand.Float64()*0.6,
	}
}

func abs16(v int16) int16 {
	if v < 0 {
		if v == -32768 {
			return 32767
		}
		return -v
	}
	return v
}

func meterLevelFromPCM16Peak(sample int16) float64 {
	norm := math.Min(1, float64(abs16(sample))/32767.0)
	if norm <= 0 {
		return 0
	}
	db := 20.0 * math.Log10(norm)
	return meterLevelFromDBFS(db)
}

func meterLevelFromDBFS(db float64) float64 {
	// Use a shared curve for idle and recording meters so behavior matches.
	if db < -60 {
		db = -60
	}
	if db > 0 {
		db = 0
	}
	linear := (db + 60.0) / 60.0
	if linear <= 0 {
		return 0
	}
	// Slightly lift lower levels for better visual sensitivity.
	return math.Pow(linear, 0.65)
}

func smoothMeterLevels(prev []float64, next []float64, attack float64, release float64) []float64 {
	if len(next) == 0 {
		return []float64{0, 0}
	}
	out := make([]float64, len(next))
	for i := range next {
		in := next[i]
		if in < 0 {
			in = 0
		}
		if in > 1 {
			in = 1
		}
		p := 0.0
		if i < len(prev) {
			p = prev[i]
		}
		alpha := release
		if in >= p {
			alpha = attack
		}
		if alpha < 0 {
			alpha = 0
		}
		if alpha > 1 {
			alpha = 1
		}
		out[i] = p + alpha*(in-p)
	}
	return out
}

func (a *App) GetWifiStatus() WifiStatus {
	status := WifiStatus{Supported: nmcliSupported(), Mode: "disconnected"}
	if !status.Supported {
		status.Error = "nmcli unavailable"
		return status
	}

	active, err := runNmcli("-t", "-f", "TYPE,NAME,DEVICE", "connection", "show", "--active")
	if err != nil {
		status.Error = err.Error()
		return status
	}

	for _, line := range strings.Split(active, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := splitNmcliEscaped(line, 3)
		if parts[0] == "wifi" || parts[0] == "802-11-wireless" {
			status.Connected = true
			status.SSID = parts[1]
			status.Device = parts[2]
			if strings.TrimSpace(parts[1]) == "PiCam-Hotspot" {
				status.Hotspot = true
				status.Mode = "hotspot"
			} else {
				status.Mode = "client"
			}
			break
		}
	}

	// Fallback: some NetworkManager setups can show active Wi-Fi in scan
	// output while connection type/name metadata is not what we expect.
	if !status.Connected {
		scanOut, scanErr := runNmcli("-t", "-f", "IN-USE,SSID", "device", "wifi", "list")
		if scanErr == nil {
			for _, line := range strings.Split(scanOut, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				parts := splitNmcliEscaped(line, 2)
				if strings.TrimSpace(parts[0]) == "*" {
					status.Connected = true
					status.SSID = strings.TrimSpace(parts[1])
					break
				}
			}
		}
	}

	if status.Device == "" {
		devOut, devErr := runNmcli("-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
		if devErr == nil {
			for _, line := range strings.Split(devOut, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				parts := splitNmcliEscaped(line, 3)
				typeVal := strings.TrimSpace(parts[1])
				stateVal := strings.TrimSpace(parts[2])
				if (typeVal == "wifi" || typeVal == "802-11-wireless") && stateVal == "connected" {
					status.Device = strings.TrimSpace(parts[0])
					break
				}
			}
		}
	}

	if status.Connected && status.Device != "" {
		ipOut, ipErr := runNmcli("-t", "-f", "IP4.ADDRESS", "device", "show", status.Device)
		if ipErr == nil {
			for _, line := range strings.Split(ipOut, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				parts := splitNmcliEscaped(line, 2)
				if len(parts) == 2 {
					status.IP = strings.Split(parts[1], "/")[0]
					break
				}
			}
		}
	}

	// Prefer the human SSID from scan output over connection profile names
	// like "netplan-wlan0-<ssid>" when possible.
	if status.Connected {
		scanOut, scanErr := runNmcli("-t", "-f", "IN-USE,SSID", "device", "wifi", "list")
		if scanErr == nil {
			for _, line := range strings.Split(scanOut, "\n") {
				line = strings.TrimSpace(line)
				if line == "" {
					continue
				}
				parts := splitNmcliEscaped(line, 2)
				if strings.TrimSpace(parts[0]) == "*" {
					ssid := strings.TrimSpace(parts[1])
					if ssid != "" {
						status.SSID = ssid
					}
					break
				}
			}
		}
	}

	status.SSID = normalizeWifiSSID(status.SSID)
	if status.Hotspot {
		a.settingsLock.Lock()
		if strings.TrimSpace(a.settings.HotspotSSID) != "" {
			status.SSID = a.settings.HotspotSSID
		}
		a.settingsLock.Unlock()
	}

	return status
}

func (a *App) ScanWifiNetworks() []WifiNetwork {
	if !nmcliSupported() {
		return []WifiNetwork{}
	}

	iface := "wlan0"
	if outDev, errDev := runNmcli("-t", "-f", "DEVICE,TYPE,STATE", "device", "status"); errDev == nil {
		for _, line := range strings.Split(outDev, "\n") {
			parts := splitNmcliEscaped(strings.TrimSpace(line), 3)
			typeVal := strings.TrimSpace(parts[1])
			if typeVal == "wifi" || typeVal == "802-11-wireless" {
				iface = strings.TrimSpace(parts[0])
				break
			}
		}
	}

	parseNmcliList := func(out string) []WifiNetwork {
		seen := map[string]bool{}
		nets := make([]WifiNetwork, 0)
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := splitNmcliEscaped(line, 4)
			ssid := strings.TrimSpace(parts[1])
			if ssid == "" {
				ssid = "<Hidden SSID>"
			}
			if seen[ssid] {
				continue
			}
			seen[ssid] = true
			signal := 0
			fmt.Sscanf(parts[2], "%d", &signal)
			nets = append(nets, WifiNetwork{InUse: strings.TrimSpace(parts[0]) == "*", SSID: ssid, Signal: signal, Security: strings.TrimSpace(parts[3])})
		}
		return nets
	}

	// Target active interface first; retry once after short delay for scan settle.
	_, _ = runNmcli("--wait", "10", "device", "wifi", "rescan", "ifname", iface)
	out, err := runNmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", iface, "--rescan", "yes")
	nets := []WifiNetwork{}
	if err == nil {
		nets = parseNmcliList(out)
	} else {
		fmt.Printf("Wi-Fi scan error (%s): %v\n", iface, err)
	}

	if len(nets) <= 1 {
		time.Sleep(1500 * time.Millisecond)
		outRetry, errRetry := runNmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", iface, "--rescan", "yes")
		if errRetry == nil {
			nets = appendUniqueWifiNetworks(nets, parseNmcliList(outRetry))
		} else {
			fmt.Printf("Wi-Fi scan retry error (%s): %v\n", iface, errRetry)
		}
	}

	if len(nets) <= 1 {
		nmcliCount := len(nets)
		bestEffortWifiPrep(iface)
		iwNets := scanWifiWithIw(iface)
		iwlistNets := scanWifiWithIwlist(iface)
		nets = appendUniqueWifiNetworks(nets, iwNets)
		nets = appendUniqueWifiNetworks(nets, iwlistNets)
		fmt.Printf("Wi-Fi sparse scan on %s: nmcli=%d iw=%d iwlist=%d merged=%d\n", iface, nmcliCount, len(iwNets), len(iwlistNets), len(nets))
	}

	return nets
}

func scanWifiWithIw(iface string) []WifiNetwork {
	out, src, err := runWifiScanCommand(6*time.Second,
		[]string{"sudo", "-n", "/usr/sbin/iw", "dev", iface, "scan", "ap-force"},
		[]string{"sudo", "-n", "iw", "dev", iface, "scan", "ap-force"},
		[]string{"/usr/sbin/iw", "dev", iface, "scan", "ap-force"},
		[]string{"iw", "dev", iface, "scan", "ap-force"},
	)
	if err != nil {
		fmt.Printf("iw scan failed on %s: %v\n", iface, err)
		return []WifiNetwork{}
	}
	if strings.Contains(strings.ToLower(string(out)), "password is required") {
		fmt.Printf("iw scan blocked on %s via %s: sudo password required\n", iface, src)
		return []WifiNetwork{}
	}

	lines := strings.Split(string(out), "\n")
	nets := make([]WifiNetwork, 0)
	seen := map[string]bool{}
	var cur WifiNetwork
	inBlock := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "BSS ") {
			if inBlock {
				if cur.SSID == "" {
					cur.SSID = "<Hidden SSID>"
				}
				if !seen[cur.SSID] {
					seen[cur.SSID] = true
					nets = append(nets, cur)
				}
			}
			cur = WifiNetwork{}
			inBlock = true
			continue
		}
		if !inBlock {
			continue
		}
		if strings.HasPrefix(line, "SSID: ") {
			cur.SSID = strings.TrimSpace(strings.TrimPrefix(line, "SSID: "))
		} else if strings.HasPrefix(line, "signal: ") {
			var dbm float64
			fmt.Sscanf(line, "signal: %f", &dbm)
			pct := int(math.Round((dbm + 100) * 2))
			if pct < 0 {
				pct = 0
			}
			if pct > 100 {
				pct = 100
			}
			cur.Signal = pct
		} else if strings.Contains(line, "RSN:") || strings.Contains(line, "WPA:") {
			if cur.Security == "" {
				cur.Security = "WPA/WPA2"
			}
		}
	}
	if inBlock {
		if cur.SSID == "" {
			cur.SSID = "<Hidden SSID>"
		}
		if !seen[cur.SSID] {
			nets = append(nets, cur)
		}
	}
	return nets
}

func scanWifiWithIwlist(iface string) []WifiNetwork {
	out, src, err := runWifiScanCommand(8*time.Second,
		[]string{"sudo", "-n", "/usr/sbin/iwlist", iface, "scan"},
		[]string{"sudo", "-n", "iwlist", iface, "scan"},
		[]string{"/usr/sbin/iwlist", iface, "scan"},
		[]string{"iwlist", iface, "scan"},
	)
	if err != nil {
		fmt.Printf("iwlist scan failed on %s: %v\n", iface, err)
		return []WifiNetwork{}
	}
	if strings.Contains(strings.ToLower(string(out)), "password is required") {
		fmt.Printf("iwlist scan blocked on %s via %s: sudo password required\n", iface, src)
		return []WifiNetwork{}
	}

	lines := strings.Split(string(out), "\n")
	nets := make([]WifiNetwork, 0)
	var cur WifiNetwork
	inCell := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.Contains(line, "Cell ") && strings.Contains(line, "Address:") {
			if inCell {
				if cur.SSID == "" {
					cur.SSID = "<Hidden SSID>"
				}
				nets = append(nets, cur)
			}
			cur = WifiNetwork{}
			inCell = true
			continue
		}
		if !inCell {
			continue
		}
		if strings.Contains(line, "ESSID:") {
			ssid := strings.TrimSpace(strings.TrimPrefix(line, "ESSID:"))
			ssid = strings.Trim(ssid, "\"")
			cur.SSID = ssid
		} else if strings.Contains(line, "Quality=") {
			var q, max int
			if _, err := fmt.Sscanf(line, "Quality=%d/%d", &q, &max); err == nil && max > 0 {
				cur.Signal = int(math.Round((float64(q) / float64(max)) * 100))
			}
		} else if strings.Contains(line, "Encryption key:") {
			if strings.Contains(line, "off") {
				cur.Security = "Open"
			} else {
				cur.Security = "Secured"
			}
		}
	}
	if inCell {
		if cur.SSID == "" {
			cur.SSID = "<Hidden SSID>"
		}
		nets = append(nets, cur)
	}

	return nets
}

func runWifiScanCommand(timeout time.Duration, attempts ...[]string) ([]byte, string, error) {
	var lastErr error
	for _, args := range attempts {
		if len(args) == 0 {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		cmd := exec.CommandContext(ctx, args[0], args[1:]...)
		out, err := cmd.CombinedOutput()
		cancel()

		if len(out) > 0 {
			if err != nil {
				lower := strings.ToLower(string(out))
				if strings.Contains(lower, "password is required") || strings.Contains(lower, "not found") || strings.Contains(lower, "operation not permitted") || strings.Contains(lower, "permission denied") {
					lastErr = fmt.Errorf("%s: %w (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
					continue
				}
			}
			return out, strings.Join(args, " "), nil
		}

		if err == nil {
			continue
		}
		lastErr = fmt.Errorf("%s: %w", strings.Join(args, " "), err)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("no scan command produced output")
	}
	return nil, "", lastErr
}

func appendUniqueWifiNetworks(base []WifiNetwork, extra []WifiNetwork) []WifiNetwork {
	seen := map[string]bool{}
	out := make([]WifiNetwork, 0, len(base)+len(extra))
	for _, n := range base {
		key := strings.TrimSpace(n.SSID)
		if key != "" {
			seen[key] = true
		}
		out = append(out, n)
	}
	for _, n := range extra {
		key := strings.TrimSpace(n.SSID)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, n)
	}
	return out
}

func bestEffortWifiPrep(iface string) {
	if strings.TrimSpace(iface) == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_ = exec.CommandContext(ctx, "iw", "dev", iface, "set", "power_save", "off").Run()
	_ = exec.CommandContext(ctx, "sudo", "-n", "/usr/sbin/iw", "dev", iface, "set", "power_save", "off").Run()
	_ = exec.CommandContext(ctx, "sudo", "-n", "iw", "dev", iface, "set", "power_save", "off").Run()
}

func (a *App) ConnectWifi(ssid string, password string) bool {
	if !nmcliSupported() || strings.TrimSpace(ssid) == "" {
		return false
	}

	iface := "wlan0"
	if out, err := runNmcli("-t", "-f", "DEVICE,TYPE,STATE", "device", "status"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			parts := splitNmcliEscaped(strings.TrimSpace(line), 3)
			typeVal := strings.TrimSpace(parts[1])
			if typeVal == "wifi" || typeVal == "802-11-wireless" {
				iface = strings.TrimSpace(parts[0])
				break
			}
		}
	}

	args := []string{"device", "wifi", "connect", ssid, "ifname", iface}
	if strings.TrimSpace(password) != "" {
		args = append(args, "password", password)
	}

	_, err := runNmcli(args...)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "key-mgmt") && strings.TrimSpace(password) != "" {
			// Some NetworkManager states fail automatic wifi connect with
			// "802-11-wireless-security.key-mgmt: property is missing".
			// Retry by creating/updating an explicit WPA-PSK profile.
			conName := "picam-" + strings.ReplaceAll(strings.TrimSpace(ssid), " ", "_")
			_, _ = runNmcli("connection", "delete", conName)
			_, addErr := runNmcli(
				"connection", "add",
				"type", "wifi",
				"ifname", iface,
				"con-name", conName,
				"ssid", ssid,
			)
			if addErr == nil {
				_, _ = runNmcli(
					"connection", "modify", conName,
					"wifi-sec.key-mgmt", "wpa-psk",
					"wifi-sec.psk", password,
				)
				if _, upErr := runNmcli("connection", "up", conName); upErr == nil {
					return true
				}
			}

			// Retry same explicit profile flow with sudo fallback.
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			runSudo := func(nmArgs ...string) error {
				sudoArgs := append([]string{"-n", "nmcli"}, nmArgs...)
				cmd := exec.CommandContext(ctx, "sudo", sudoArgs...)
				out, sudoErr := cmd.CombinedOutput()
				if sudoErr != nil {
					return fmt.Errorf("%w (%s)", sudoErr, strings.TrimSpace(string(out)))
				}
				return nil
			}
			_ = runSudo("connection", "delete", conName)
			if runSudo("connection", "add", "type", "wifi", "ifname", iface, "con-name", conName, "ssid", ssid) == nil {
				_ = runSudo("connection", "modify", conName, "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", password)
				if runSudo("connection", "up", conName) == nil {
					return true
				}
			}
		}

		if strings.Contains(errMsg, "Not authorized to control networking") {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			sudoArgs := append([]string{"-n", "nmcli"}, args...)
			cmd := exec.CommandContext(ctx, "sudo", sudoArgs...)
			out, sudoErr := cmd.CombinedOutput()
			if sudoErr == nil {
				return true
			}
			fmt.Printf("Wi-Fi connect sudo fallback failed: %v (%s)\n", sudoErr, strings.TrimSpace(string(out)))
		}
		fmt.Printf("Wi-Fi connect error: %v\n", err)
		return false
	}

	// If client connect succeeded, make sure hotspot mode is down.
	_ = a.StopHotspot()
	return true
}

func runNmcliWithSudoFallback(args ...string) error {
	_, err := runNmcli(args...)
	if err == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	sudoArgs := append([]string{"-n", "nmcli"}, args...)
	cmd := exec.CommandContext(ctx, "sudo", sudoArgs...)
	out, sudoErr := cmd.CombinedOutput()
	if sudoErr == nil {
		return nil
	}

	return fmt.Errorf("nmcli %v failed: %v; sudo fallback failed: %v (%s)", args, err, sudoErr, strings.TrimSpace(string(out)))
}

func runSudoCommand(timeout time.Duration, bin string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	all := append([]string{"-n", bin}, args...)
	cmd := exec.CommandContext(ctx, "sudo", all...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("sudo %s %v failed: %v (%s)", bin, args, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *App) GetHotspotStatus() map[string]any {
	status := map[string]any{
		"supported": nmcliSupported(),
		"active":    false,
		"ssid":      "",
	}
	if !nmcliSupported() {
		return status
	}

	out, err := runNmcli("-t", "-f", "TYPE,NAME,DEVICE", "connection", "show", "--active")
	if err != nil {
		status["error"] = err.Error()
		return status
	}

	for _, line := range strings.Split(out, "\n") {
		parts := splitNmcliEscaped(strings.TrimSpace(line), 3)
		if strings.TrimSpace(parts[0]) == "wifi" && strings.TrimSpace(parts[1]) == "PiCam-Hotspot" {
			status["active"] = true
			status["device"] = strings.TrimSpace(parts[2])
			break
		}
	}

	if status["active"] == true {
		a.settingsLock.Lock()
		status["ssid"] = a.settings.HotspotSSID
		a.settingsLock.Unlock()
	}

	return status
}

func (a *App) StartHotspot(ssid string, password string) bool {
	if !nmcliSupported() {
		return false
	}

	ssid = strings.TrimSpace(ssid)
	password = strings.TrimSpace(password)
	if ssid == "" {
		a.settingsLock.Lock()
		ssid = strings.TrimSpace(a.settings.HotspotSSID)
		password = strings.TrimSpace(a.settings.HotspotPassword)
		a.settingsLock.Unlock()
	}
	if ssid == "" || len(password) < 8 {
		fmt.Printf("Hotspot config invalid: ssid=%q passwordLen=%d\n", ssid, len(password))
		return false
	}

	iface := "wlan0"
	if out, err := runNmcli("-t", "-f", "DEVICE,TYPE,STATE", "device", "status"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			parts := splitNmcliEscaped(strings.TrimSpace(line), 3)
			typeVal := strings.TrimSpace(parts[1])
			if typeVal == "wifi" || typeVal == "802-11-wireless" {
				iface = strings.TrimSpace(parts[0])
				break
			}
		}
	}

	_ = runNmcliWithSudoFallback("radio", "wifi", "on")
	_ = runSudoCommand(5*time.Second, "rfkill", "unblock", "wifi")
	_ = runNmcliWithSudoFallback("device", "set", iface, "managed", "yes")

	_ = runNmcliWithSudoFallback("connection", "down", "PiCam-Hotspot")
	_ = runNmcliWithSudoFallback("connection", "delete", "PiCam-Hotspot")

	// Preferred deterministic AP profile path.
	err := runNmcliWithSudoFallback("connection", "add", "type", "wifi", "ifname", iface, "con-name", "PiCam-Hotspot", "autoconnect", "yes", "ssid", ssid)
	if err == nil {
		err = runNmcliWithSudoFallback("connection", "modify", "PiCam-Hotspot",
			"802-11-wireless.mode", "ap",
			"802-11-wireless.band", "bg",
			"ipv4.method", "shared",
			"ipv6.method", "ignore",
			"wifi-sec.key-mgmt", "wpa-psk",
			"wifi-sec.psk", password,
		)
	}
	if err == nil {
		err = runNmcliWithSudoFallback("connection", "up", "PiCam-Hotspot")
	}

	// Fallback to nmcli hotspot shortcut if profile path fails.
	if err != nil {
		fmt.Printf("Hotspot profile path failed on %s: %v\n", iface, err)
		err = runNmcliWithSudoFallback(
			"device", "wifi", "hotspot",
			"ifname", iface,
			"con-name", "PiCam-Hotspot",
			"ssid", ssid,
			"password", password,
		)
	}
	if err != nil {
		fmt.Printf("Hotspot start failed on %s: %v\n", iface, err)
		return false
	}

	fmt.Printf("Hotspot started on %s ssid=%q\n", iface, ssid)

	a.settingsLock.Lock()
	a.settings.HotspotSSID = ssid
	a.settings.HotspotPassword = password
	a.settingsLock.Unlock()
	a.SaveSettings()
	return true
}

func (a *App) StopHotspot() bool {
	if !nmcliSupported() {
		return false
	}

	if err := runNmcliWithSudoFallback("connection", "down", "PiCam-Hotspot"); err != nil {
		_ = runNmcliWithSudoFallback("connection", "delete", "PiCam-Hotspot")
		return false
	}
	_ = runNmcliWithSudoFallback("connection", "delete", "PiCam-Hotspot")
	return true
}

func (a *App) monitorAutoHotspotFallback() {
	if runtime.GOOS != "linux" {
		return
	}

	// Option A: fixed timeout then bounded retries.
	initial := time.NewTimer(28 * time.Second)
	defer initial.Stop()
	select {
	case <-a.stopCh:
		return
	case <-initial.C:
	}

	for i := 0; i < 6; i++ {
		if a.isStopping() {
			return
		}

		a.settingsLock.Lock()
		autoOn := a.settings.AutoHotspot
		ssid := a.settings.HotspotSSID
		password := a.settings.HotspotPassword
		a.settingsLock.Unlock()

		if !autoOn {
			fmt.Println("Auto-hotspot disabled in settings; skipping fallback.")
			return
		}

		st := a.GetWifiStatus()
		fmt.Printf("Auto-hotspot check #%d: mode=%s connected=%t ssid=%q\n", i+1, st.Mode, st.Connected, st.SSID)
		if st.Mode == "hotspot" {
			return
		}
		if st.Connected && st.Mode == "client" {
			return
		}

		if a.StartHotspot(ssid, password) {
			fmt.Printf("Auto-hotspot enabled: %s\n", ssid)
			return
		}

		wait := time.NewTimer(20 * time.Second)
		select {
		case <-a.stopCh:
			wait.Stop()
			return
		case <-wait.C:
		}
	}

	fmt.Println("Auto-hotspot failed after retries.")
}

// ToggleRecording handles the record button
func (a *App) ToggleRecording() bool {
	a.settingsLock.Lock()
	defer a.settingsLock.Unlock()
	return a.toggleRecordingInternal()
}

func (a *App) toggleRecordingInternal() bool {
	a.isRecording = !a.isRecording
	if a.isRecording {
		atomic.StoreInt64(&a.recordFrames, 0)
		a.recordRetry = false
		a.recordStart = time.Now()
		a.audioMuxEnabled = false
		a.audioRecordPath = ""
		a.audioRecordCmd = nil
		a.recordStopCh = make(chan struct{})
		a.recordDoneCh = make(chan struct{})
		fmt.Println("Recording Started")

		// Drain the record channel in case there's old data
		for len(a.recordChan) > 0 {
			<-a.recordChan
		}

		if runtime.GOOS == "windows" {
			os.MkdirAll("captures", 0755)
			ext := strings.ToLower(a.settings.Container)
			fname := fmt.Sprintf("CLIP_%s.%s", a.recordStart.Format("20060102_150405"), ext)
			os.WriteFile(filepath.Join("captures", fname), []byte("dummy video data"), 0644)
		} else {
			if runtime.GOOS == "linux" && a.settings.AudioEnabled {
				a.startAudioSidecarRecord()
			}
			targetFPS := a.settings.FPS
			if targetFPS <= 0 {
				targetFPS = 24
			}

			// On Linux/Pi, we start an ffmpeg process to consume the MJPEG tap.
			// Guard against concurrent ALSA sampling from live VU monitoring.
			a.audioCaptureMu.Lock()
			a.startProductionRecord()
			a.audioCaptureMu.Unlock()
			if a.recordPipe == nil || a.recordCmd == nil {
				fmt.Println("Recording failed to initialize.")
				a.isRecording = false
				return a.isRecording
			}

			// Start a paced writer goroutine to keep output duration true to wall-clock time.
			go func(fps float64) {
				defer close(a.recordDoneCh)
				interval := time.Duration(float64(time.Second) / fps)
				if interval < 10*time.Millisecond {
					interval = 10 * time.Millisecond
				}

				ticker := time.NewTicker(interval)
				defer ticker.Stop()

				var lastFrame []byte
				for {
					if a.recordPipe == nil {
						return
					}

					select {
					case <-a.recordStopCh:
						return
					case <-ticker.C:
						var frame []byte
						select {
						case frame = <-a.recordChan:
							lastFrame = frame
						default:
							frame = lastFrame
						}

						if frame == nil || a.recordPipe == nil {
							continue
						}

						if _, err := a.recordPipe.Write(frame); err != nil {
							fmt.Printf("Recording pipe error: %v\n", err)
							return
						}
						atomic.AddInt64(&a.recordFrames, 1)
					}
				}
			}(targetFPS)
		}
	} else {
		fmt.Printf("Recording Stopped. Duration: %v\n", time.Since(a.recordStart))

		fps := a.settings.FPS
		if fps <= 0 {
			fps = 24
		}

		pending := len(a.recordChan)
		if pending > 0 {
			flushMs := int(math.Ceil((float64(pending) / fps) * 1000.0))
			if flushMs > 1400 {
				flushMs = 1400
			}
			if flushMs > 0 {
				time.Sleep(time.Duration(flushMs) * time.Millisecond)
			}
		}

		if a.recordStopCh != nil {
			close(a.recordStopCh)
			a.recordStopCh = nil
		}

		if a.recordDoneCh != nil {
			select {
			case <-a.recordDoneCh:
			case <-time.After(800 * time.Millisecond):
			}
			a.recordDoneCh = nil
		}

		if a.recordPipe != nil {
			a.recordPipe.Close()
			a.recordPipe = nil
		}

		a.stopAudioSidecarRecord()

		if a.recordProcDone != nil {
			// Finalize continues in background watcher; do not block stop UX.
			a.recordProcDone = nil
		}

		sessionFrames := atomic.LoadInt64(&a.recordFrames)
		if runtime.GOOS == "windows" && sessionFrames == 0 {
			sessionFrames = int64(math.Max(0, math.Round(time.Since(a.recordStart).Seconds()*fps)))
		}
		if sessionFrames > 0 {
			a.settings.TimecodeFrames += sessionFrames
			a.SaveSettings()
			fmt.Printf("Recording finalized frames: %d (~%.2fs @ %.0ffps)\n", sessionFrames, float64(sessionFrames)/fps, fps)
		}

		if a.recordCmd != nil {
			// Process wait/finalize is handled by dedicated recorder watcher.
		}
	}

	return a.isRecording
}

// startProductionRecord initializes the ffmpeg tap
func (a *App) startProductionRecord() {
	if a.startProductionRecordWithMode(false) {
		a.recordAudioOn = false
		return
	}

	fmt.Println("Failed to start recording pipeline.")
}

func (a *App) startProductionRecordWithMode(_ bool) bool {
	os.MkdirAll("captures", 0755)
	ext := strings.ToLower(a.settings.Container)
	fname := filepath.Join("captures", fmt.Sprintf("CLIP_%s.%s", a.recordStart.Format("20060102_150405"), ext))
	a.recordFinalPath = fname

	recordW, recordH := "1920", "1080"
	switch a.settings.RecordResolution {
	case "720p":
		recordW, recordH = "1280", "720"
	case "1080p":
		recordW, recordH = "1920", "1080"
	case "2K":
		recordW, recordH = "2048", "1080"
	case "4K":
		recordW, recordH = "3840", "2160"
	}

	previewW, previewH := "1280", "720"
	switch a.settings.Resolution {
	case "1080p":
		previewW, previewH = "1920", "1080"
	case "2K":
		previewW, previewH = "2048", "1080"
	case "4K":
		previewW, previewH = "3840", "2160"
	}

	needsScale := recordW != previewW || recordH != previewH
	fpsRounded := fmt.Sprintf("%.0f", a.settings.FPS)

	// ffmpeg command optimized for smooth motion and hardware acceleration.
	// IMPORTANT: input options/inputs must be declared before output codec options.
	args := []string{
		"-fflags", "+genpts",
		"-f", "mjpeg",
		"-framerate", fmt.Sprintf("%f", a.settings.FPS),
		"-i", "pipe:0",
	}

	args = append(args,
		"-c:v", "h264_v4l2m2m", // Pi 4 HW Encoder
		"-bf", "0",
		"-g", fpsRounded,
		"-keyint_min", fpsRounded,
		"-b:v", fmt.Sprintf("%dM", a.settings.Bitrate),
		"-maxrate", fmt.Sprintf("%dM", a.settings.Bitrate),
		"-bufsize", fmt.Sprintf("%dM", a.settings.Bitrate*2),
		"-fps_mode", "passthrough",
		"-pix_fmt", "yuv420p",
	)

	args = append(args, "-an")

	if needsScale {
		args = append(args, "-vf", fmt.Sprintf("scale=%s:%s:flags=bicubic", recordW, recordH))
	}

	if ext == "mp4" {
		args = append(args, "-movflags", "+faststart")
	}

	args = append(args, "-y", fname)

	cmd := exec.Command("ffmpeg", args...)
	configureCmd(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Printf("Failed to create record stderr pipe: %v\n", err)
		return false
	}
	pipe, err := cmd.StdinPipe()
	if err != nil {
		fmt.Printf("Failed to create record pipe: %v\n", err)
		return false
	}

	if err := cmd.Start(); err != nil {
		fmt.Printf("Failed to start ffmpeg record: %v\n", err)
		return false
	}

	a.recordPipe = pipe
	a.recordCmd = cmd
	a.recordPath = fname
	a.recordProcDone = make(chan struct{})
	a.launchRecordWatcher(cmd, fname, false, stderr, a.recordProcDone)
	return true
}

func alsaInputAvailable(device string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	try := func(ch string) bool {
		cmd := exec.CommandContext(ctx, "arecord", "-D", device, "-f", "S16_LE", "-c", ch, "-r", "48000", "-d", "1", "/dev/null")
		return cmd.Run() == nil
	}
	if try("2") {
		return true
	}
	return try("1")
}

func (a *App) launchRecordWatcher(cmd *exec.Cmd, outPath string, startedWithAudio bool, stderr io.ReadCloser, done chan struct{}) {
	go func() {
		if stderr != nil {
			scanner := bufio.NewScanner(stderr)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line != "" {
					fmt.Printf("REC ffmpeg: %s\n", line)
				}
			}
		}
	}()

	go func() {
		defer close(done)
		err := cmd.Wait()

		a.settingsLock.Lock()
		isCurrent := a.recordCmd == cmd
		recording := a.isRecording
		retryAllowed := !a.recordRetry
		if isCurrent {
			a.recordCmd = nil
			a.recordPipe = nil
			a.recordPath = ""
		}
		shouldRetry := isCurrent && recording && startedWithAudio && retryAllowed
		if shouldRetry {
			a.recordRetry = true
		}
		a.settingsLock.Unlock()

		if err != nil {
			fmt.Printf("Recording process exited: %v\n", err)
		}

		if shouldRetry {
			fmt.Println("Recorder exited while recording with audio; retrying video-only.")
			a.audioCaptureMu.Lock()
			ok := a.startProductionRecordWithMode(false)
			a.audioCaptureMu.Unlock()
			if !ok {
				fmt.Println("Video-only retry failed; stopping recording.")
				a.settingsLock.Lock()
				a.isRecording = false
				a.settingsLock.Unlock()
			}
			return
		}

		if strings.TrimSpace(outPath) != "" {
			if a.audioMuxEnabled && strings.TrimSpace(a.audioRecordPath) != "" {
				a.muxSidecarAudio(outPath, a.audioRecordPath)
			}
			fmt.Println("Recording process finalized.")
			a.generateThumbnail(outPath)
		}
	}()
}

func (a *App) startAudioSidecarRecord() {
	a.audioCaptureMu.Lock()
	defer a.audioCaptureMu.Unlock()

	device := strings.TrimSpace(a.settings.AudioDevice)
	if device == "" {
		device = "plughw:1,0"
	}

	audioExt := "m4a"
	if strings.EqualFold(a.settings.AudioFormat, "32-bit Float") {
		audioExt = "mka"
	}
	audioPath := filepath.Join("captures", fmt.Sprintf("CLIP_%s_audio.%s", a.recordStart.Format("20060102_150405"), audioExt))

	args := []string{
		"-hide_banner",
		"-loglevel", "info",
		"-thread_queue_size", "1024",
		"-f", "alsa",
		"-ar", "48000",
		"-ac", "2",
		"-i", device,
		"-vn",
		"-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.1.Peak_level",
	}

	if strings.EqualFold(a.settings.AudioFormat, "32-bit Float") {
		args = append(args, "-c:a", "pcm_f32le")
	} else {
		args = append(args, "-c:a", "aac", "-b:a", "192k")
	}
	args = append(args, "-y", audioPath)

	cmd := exec.Command("ffmpeg", args...)
	configureCmd(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Printf("Audio sidecar stderr pipe failed: %v\n", err)
		return
	}
	if err := cmd.Start(); err != nil {
		fmt.Printf("Audio sidecar start failed: %v\n", err)
		return
	}

	a.audioRecordCmd = cmd
	a.audioRecordPath = audioPath
	a.audioMuxEnabled = true
	localDone := make(chan struct{})
	a.audioProcDone = localDone
	fmt.Printf("Audio sidecar recording started: %s\n", audioPath)

	go func(stderr io.ReadCloser) {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "lavfi.astats.1.Peak_level=") {
				parts := strings.Split(line, "=")
				if len(parts) >= 2 {
					db, err := strconv.ParseFloat(strings.TrimSpace(parts[len(parts)-1]), 64)
					if err == nil {
						raw := meterLevelFromDBFS(db)
						a.audioLevelMu.Lock()
						levels := smoothMeterLevels(a.audioLevelVal, []float64{raw, raw}, 0.85, 0.18)
						a.audioLevelTS = time.Now()
						a.audioLevelVal = levels
						a.audioLevelMu.Unlock()
					}
				}
			}
		}
	}(stderr)

	go func(localCmd *exec.Cmd, localPath string, done chan struct{}) {
		defer close(done)
		err := localCmd.Wait()
		a.settingsLock.Lock()
		stillRecording := a.isRecording
		isSame := a.audioRecordCmd == localCmd
		if isSame {
			a.audioRecordCmd = nil
		}
		if stillRecording {
			a.audioMuxEnabled = false
		}
		a.settingsLock.Unlock()
		if err != nil {
			fmt.Printf("Audio sidecar process exited: %v (%s)\n", err, localPath)
		}
	}(cmd, audioPath, localDone)
}

func (a *App) stopAudioSidecarRecord() {
	a.audioCaptureMu.Lock()
	defer a.audioCaptureMu.Unlock()

	if a.audioRecordCmd == nil {
		return
	}

	localCmd := a.audioRecordCmd
	localDone := a.audioProcDone

	_ = localCmd.Process.Signal(os.Interrupt)
	if localDone != nil {
		select {
		case <-localDone:
		case <-time.After(900 * time.Millisecond):
			if runtime.GOOS == "linux" {
				_ = localCmd.Process.Signal(syscall.SIGTERM)
			}
			select {
			case <-localDone:
			case <-time.After(900 * time.Millisecond):
				_ = localCmd.Process.Kill()
				fmt.Println("Audio sidecar stop timeout; force-killed.")
			}
			select {
			case <-localDone:
			case <-time.After(1200 * time.Millisecond):
				fmt.Println("Audio sidecar did not exit after kill; continuing.")
			}
		}
	}

	a.audioRecordCmd = nil
	a.audioProcDone = nil
}

func (a *App) muxSidecarAudio(videoPath, audioPath string) {
	if _, err := os.Stat(videoPath); err != nil {
		return
	}
	if _, err := os.Stat(audioPath); err != nil {
		return
	}

	ext := strings.ToLower(filepath.Ext(videoPath))
	if ext == "" {
		ext = ".mp4"
	}
	tmpOut := strings.TrimSuffix(videoPath, ext) + ".mux.tmp" + ext
	args := []string{"-y", "-i", videoPath, "-i", audioPath, "-c:v", "copy", "-shortest"}
	if strings.EqualFold(a.settings.AudioFormat, "32-bit Float") {
		args = append(args, "-c:a", "pcm_f32le")
	} else {
		args = append(args, "-af", "aresample=async=1:first_pts=0", "-c:a", "aac", "-b:a", "192k")
	}
	args = append(args, tmpOut)

	cmd := exec.Command("ffmpeg", args...)
	configureCmd(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		fmt.Printf("Audio/video mux failed: %v\n", err)
		if msg := strings.TrimSpace(stderr.String()); msg != "" {
			fmt.Printf("Mux stderr: %s\n", msg)
		}
		return
	}

	if err := os.Rename(tmpOut, videoPath); err != nil {
		fmt.Printf("Mux output replace failed: %v\n", err)
		return
	}

	_ = os.Remove(audioPath)
	fmt.Println("Audio sidecar mux complete.")
}

func (a *App) ListAudioDevices() []AudioDeviceInfo {
	if runtime.GOOS != "linux" {
		return []AudioDeviceInfo{}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "arecord", "-l")
	out, err := cmd.Output()
	if err != nil {
		return []AudioDeviceInfo{}
	}

	re := regexp.MustCompile(`card\s+(\d+):\s*([^,]+),\s*device\s+(\d+):\s*([^\[]+)`)
	devices := make([]AudioDeviceInfo, 0)
	for _, line := range strings.Split(string(out), "\n") {
		m := re.FindStringSubmatch(strings.TrimSpace(line))
		if len(m) != 5 {
			continue
		}
		value := fmt.Sprintf("plughw:%s,%s", m[1], m[3])
		label := fmt.Sprintf("%s (%s)", strings.TrimSpace(m[4]), value)
		devices = append(devices, AudioDeviceInfo{Label: label, Value: value})
	}

	return devices
}

func (a *App) startMediaMTXPublisher() {
	if !a.ensureMediaMTXRunning() {
		fmt.Println("MediaMTX server unavailable; skipping publisher start")
		a.scheduleMediaMTXRestart("server unavailable")
		return
	}

	if a.isStopping() {
		return
	}

	a.streamMu.Lock()
	if a.streamCmd != nil {
		a.streamMu.Unlock()
		return
	}
	a.streamStop = false
	a.streamMu.Unlock()

	a.settingsLock.Lock()
	fps := a.settings.FPS
	bitrate := a.settings.Bitrate
	streamAudio := a.settings.StreamAudio
	streamPath := strings.TrimSpace(a.settings.StreamPath)
	audioDevice := strings.TrimSpace(a.settings.AudioDevice)
	a.settingsLock.Unlock()
	if streamPath == "" {
		streamPath = "picam"
	}
	if audioDevice == "" {
		audioDevice = "plughw:1,0"
	}
	if strings.HasPrefix(audioDevice, "hw:") {
		audioDevice = "plughw:" + strings.TrimPrefix(audioDevice, "hw:")
	}
	if streamAudio && !alsaInputAvailable(audioDevice) {
		fmt.Printf("MediaMTX audio preflight warning for %s; attempting audio path anyway\n", audioDevice)
	}
	targetURL := fmt.Sprintf("rtsp://127.0.0.1:8554/%s", streamPath)

	videoArgs := []string{
		"-fflags", "+genpts",
		"-f", "mjpeg",
		"-framerate", fmt.Sprintf("%f", fps),
		"-i", "pipe:0",
		"-c:v", "h264_v4l2m2m",
		"-bf", "0",
		"-b:v", fmt.Sprintf("%dM", bitrate),
		"-pix_fmt", "yuv420p",
		"-g", fmt.Sprintf("%.0f", fps),
		"-keyint_min", fmt.Sprintf("%.0f", fps),
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		"-pkt_size", "1200",
		targetURL,
	}

	args := append([]string{}, videoArgs...)
	startedWithAudio := false
	if streamAudio {
		args = []string{
			"-fflags", "+genpts",
			"-f", "mjpeg",
			"-framerate", fmt.Sprintf("%f", fps),
			"-i", "pipe:0",
			"-thread_queue_size", "1024",
			"-f", "alsa",
			"-i", audioDevice,
			"-map", "0:v:0",
			"-map", "1:a:0",
			"-c:v", "h264_v4l2m2m",
			"-bf", "0",
			"-b:v", fmt.Sprintf("%dM", bitrate),
			"-pix_fmt", "yuv420p",
			"-g", fmt.Sprintf("%.0f", fps),
			"-keyint_min", fmt.Sprintf("%.0f", fps),
			"-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
			"-c:a", "libopus",
			"-ar", "48000",
			"-ac", "2",
			"-b:a", "128k",
			"-f", "rtsp",
			"-rtsp_transport", "tcp",
			"-pkt_size", "1200",
			targetURL,
		}
		startedWithAudio = true
	}

	cmd := exec.Command("ffmpeg", args...)
	configureCmd(cmd)
	pipe, err := cmd.StdinPipe()
	if err != nil {
		fmt.Printf("Failed to create MediaMTX pipe: %v\n", err)
		a.scheduleMediaMTXRestart("stdin pipe failed")
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Printf("Failed to create MediaMTX stderr pipe: %v\n", err)
		a.scheduleMediaMTXRestart("stderr pipe failed")
		return
	}

	if err := cmd.Start(); err != nil {
		if streamAudio {
			fmt.Printf("MediaMTX audio stream start failed, retrying video-only: %v\n", err)
			startedWithAudio = false
			cmd = exec.Command("ffmpeg", videoArgs...)
			configureCmd(cmd)
			pipe, err = cmd.StdinPipe()
			if err == nil {
				stderr, err = cmd.StderrPipe()
			}
			if err == nil {
				err = cmd.Start()
			}
		}
		if err != nil {
			fmt.Printf("Failed to start MediaMTX publisher: %v\n", err)
			a.scheduleMediaMTXRestart("publisher start failed")
			return
		}
	}

	a.streamMu.Lock()
	a.streamPipe = pipe
	a.streamCmd = cmd
	a.streamAudioOn = startedWithAudio
	a.streamMu.Unlock()
	fmt.Printf("MediaMTX publisher started: %s\n", targetURL)

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			if a.isStopping() {
				return
			}
			fmt.Printf("[MediaMTX FFmpeg] %s\n", scanner.Text())
		}
	}()

	go func(localCmd *exec.Cmd) {
		err := localCmd.Wait()
		a.streamMu.Lock()
		stopped := a.streamStop
		if a.streamCmd == localCmd {
			a.streamCmd = nil
			a.streamPipe = nil
			a.streamAudioOn = false
		}
		a.streamMu.Unlock()
		if err != nil {
			fmt.Printf("MediaMTX publisher exited: %v\n", err)
		}
		if !stopped && !a.isStopping() {
			a.scheduleMediaMTXRestart("publisher exited")
		}
	}(cmd)

	go func() {
		for frame := range a.streamChan {
			if a.isStopping() {
				return
			}
			a.streamMu.Lock()
			pipe := a.streamPipe
			a.streamMu.Unlock()
			if pipe == nil {
				return
			}
			if _, err := pipe.Write(frame); err != nil {
				fmt.Printf("MediaMTX pipe error: %v\n", err)
				a.scheduleMediaMTXRestart("broken pipe")
				return
			}
		}
	}()
}

func (a *App) ensureMediaMTXRunning() bool {
	a.mtxMu.Lock()
	running := a.mtxCmd != nil && a.mtxCmd.Process != nil
	a.mtxMu.Unlock()
	if running {
		return true
	}
	return a.startMediaMTXServer()
}

func (a *App) startMediaMTXServer() bool {
	a.mtxMu.Lock()
	if a.mtxCmd != nil && a.mtxCmd.Process != nil {
		a.mtxMu.Unlock()
		return true
	}
	a.mtxMu.Unlock()

	cfgPath := "mediamtx.yml"
	if _, err := os.Stat(cfgPath); err != nil {
		fmt.Printf("MediaMTX config missing: %v\n", err)
		return false
	}

	bin := resolveMediaMTXBinary()
	if bin == "" {
		fmt.Println("MediaMTX binary not found. Set PICAM_MEDIAMTX_BIN or place binary at ./mediamtx")
		return false
	}

	cmd := exec.Command(bin, cfgPath)
	configureCmd(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		fmt.Printf("MediaMTX stderr pipe failed: %v\n", err)
		return false
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Printf("MediaMTX stdout pipe failed: %v\n", err)
		return false
	}
	if err := cmd.Start(); err != nil {
		fmt.Printf("MediaMTX start failed (%s): %v\n", bin, err)
		return false
	}

	a.mtxMu.Lock()
	a.mtxCmd = cmd
	a.mtxMu.Unlock()

	logPipe := func(prefix string, r io.ReadCloser) {
		go func() {
			s := bufio.NewScanner(r)
			for s.Scan() {
				if a.isStopping() {
					return
				}
				fmt.Printf("[%s] %s\n", prefix, s.Text())
			}
		}()
	}
	logPipe("MediaMTX", stdout)
	logPipe("MediaMTX", stderr)

	go func(localCmd *exec.Cmd) {
		err := localCmd.Wait()
		a.mtxMu.Lock()
		if a.mtxCmd == localCmd {
			a.mtxCmd = nil
		}
		a.mtxMu.Unlock()
		if err != nil && !a.isStopping() {
			fmt.Printf("MediaMTX exited: %v\n", err)
		}
	}(cmd)

	time.Sleep(700 * time.Millisecond)
	fmt.Println("MediaMTX server started")
	return true
}

func resolveMediaMTXBinary() string {
	if env := strings.TrimSpace(os.Getenv("PICAM_MEDIAMTX_BIN")); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env
		}
	}

	candidates := []string{
		"./mediamtx",
		"mediamtx",
		"/usr/local/bin/mediamtx",
		"/usr/bin/mediamtx",
	}

	for _, c := range candidates {
		if strings.HasPrefix(c, "./") {
			if _, err := os.Stat(c); err == nil {
				return c
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil && strings.TrimSpace(p) != "" {
			return p
		}
	}

	return ""
}

func (a *App) stopMediaMTXServer() {
	a.mtxMu.Lock()
	cmd := a.mtxCmd
	a.mtxCmd = nil
	a.mtxMu.Unlock()
	terminateCmd(cmd)
}

func (a *App) stopMediaMTXPublisher() {
	a.streamMu.Lock()
	a.streamStop = true
	pipe := a.streamPipe
	cmd := a.streamCmd
	a.streamPipe = nil
	a.streamCmd = nil
	a.streamAudioOn = false
	a.streamMu.Unlock()

	if pipe != nil {
		pipe.Close()
	}
	terminateCmd(cmd)
}

func (a *App) scheduleMediaMTXRestart(reason string) {
	if runtime.GOOS != "linux" {
		return
	}
	go func() {
		if a.isStopping() {
			return
		}
		fmt.Printf("MediaMTX publisher restart scheduled (%s)\n", reason)
		time.Sleep(1200 * time.Millisecond)
		a.streamMu.Lock()
		if a.streamStop || a.streamCmd != nil {
			a.streamMu.Unlock()
			return
		}
		a.streamMu.Unlock()
		if !a.isStopping() {
			a.startMediaMTXPublisher()
		}
	}()
}

func (a *App) monitorMediaMTXPublisher() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if a.isStopping() {
			return
		}
		a.streamMu.Lock()
		stopped := a.streamStop
		cmd := a.streamCmd
		a.streamMu.Unlock()

		if stopped {
			continue
		}

		if cmd == nil {
			a.startMediaMTXPublisher()
		}
	}
}

func (a *App) GetStreamingStatus() map[string]any {
	a.streamMu.Lock()
	active := a.streamCmd != nil
	audioLive := a.streamAudioOn
	a.streamMu.Unlock()
	a.mtxMu.Lock()
	server := a.mtxCmd != nil
	a.mtxMu.Unlock()

	a.settingsLock.Lock()
	enabled := a.settings.StreamEnabled
	audio := a.settings.StreamAudio
	path := a.settings.StreamPath
	a.settingsLock.Unlock()
	if strings.TrimSpace(path) == "" {
		path = "picam"
	}

	return map[string]any{
		"enabled":   enabled,
		"active":    active,
		"server":    server,
		"audio":     audio,
		"audioLive": audioLive,
		"path":      path,
		"rtspUrl":   fmt.Sprintf("rtsp://<pi-ip>:8554/%s", path),
		"webrtcUrl": fmt.Sprintf("http://<pi-ip>:8889/%s", path),
	}
}

func (a *App) StartStreaming() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	if !a.ensureMediaMTXRunning() {
		return false
	}
	a.settingsLock.Lock()
	a.settings.StreamEnabled = true
	a.settingsLock.Unlock()
	a.SaveSettings()

	a.startMediaMTXPublisher()
	return true
}

func (a *App) StopStreaming() bool {
	a.settingsLock.Lock()
	a.settings.StreamEnabled = false
	a.settingsLock.Unlock()
	a.SaveSettings()
	a.stopMediaMTXPublisher()
	a.stopMediaMTXServer()
	return true
}

// SaveSettings writes current settings to disk
func (a *App) SaveSettings() {
	data, err := json.MarshalIndent(a.settings, "", "  ")
	if err != nil {
		fmt.Printf("Error marshaling settings: %v\n", err)
		return
	}
	err = os.WriteFile("settings.json", data, 0644)
	if err != nil {
		fmt.Printf("Error saving settings: %v\n", err)
	}
}

// LoadSettings reads settings from disk
func (a *App) LoadSettings() {
	data, err := os.ReadFile("settings.json")
	if err != nil {
		if !os.IsNotExist(err) {
			fmt.Printf("Error reading settings: %v\n", err)
		}
		return
	}
	var s CameraSettings
	if err := json.Unmarshal(data, &s); err == nil {
		s = normalizeCameraSettings(s)
		a.settingsLock.Lock()
		a.settings = s
		a.settingsLock.Unlock()
		fmt.Println("Settings loaded from settings.json")
	}
}

// GetConfig returns the current camera settings
func (a *App) GetConfig() CameraSettings {
	a.settingsLock.Lock()
	defer a.settingsLock.Unlock()
	return a.settings
}

// UpdateConfig is called from the frontend
func (a *App) UpdateConfig(settings CameraSettings) {
	settings = normalizeCameraSettings(settings)

	a.settingsLock.Lock()
	if configsEqual(a.settings, settings) {
		a.settingsLock.Unlock()
		return
	}
	oldFPS := a.settings.FPS
	oldISO := a.settings.ISO
	oldShutter := a.settings.Shutter
	oldWB := a.settings.WB
	oldKelvin := a.settings.Kelvin
	oldRes := a.settings.Resolution
	oldBitrate := a.settings.Bitrate
	oldStreamAudio := a.settings.StreamAudio
	oldStreamPath := a.settings.StreamPath
	a.settings = settings
	a.settingsLock.Unlock()

	a.SaveSettings()

	fmt.Printf("Camera Hardware Config Updated: FPS:%v ISO:%v SHUT:%s WB:%s Kelvin:%v Res:%s\n", settings.FPS, settings.ISO, settings.Shutter, settings.WB, settings.Kelvin, settings.Resolution)

	if runtime.GOOS == "linux" {
		a.streamMu.Lock()
		streamPublisherActive := a.streamCmd != nil
		a.streamMu.Unlock()
		if streamPublisherActive && settings.StreamEnabled && (settings.StreamAudio != oldStreamAudio || settings.StreamPath != oldStreamPath || settings.Bitrate != oldBitrate) {
			a.stopMediaMTXPublisher()
			a.startMediaMTXPublisher()
		}

		sourceChanged := settings.Resolution != oldRes

		if settings.FPS != oldFPS || settings.ISO != oldISO || settings.Shutter != oldShutter || settings.WB != oldWB || settings.Kelvin != oldKelvin || sourceChanged {
			// If we change FPS or Resolution, we must stop recording
			if (settings.FPS != oldFPS || sourceChanged) && a.isRecording {
				a.toggleRecordingInternal()
			}

			a.cmdMu.Lock()
			oldCmd := a.cmd
			a.cmd = nil
			a.cmdMu.Unlock()

			terminateCmd(oldCmd)
			cleanupOrphanProcesses()
			time.Sleep(250 * time.Millisecond)

		}

		if settings.FPS != oldFPS || settings.Resolution != oldRes || settings.Bitrate != oldBitrate {
			// Keep publisher alive; frame source restart is enough and avoids path flapping.
		}
	}
}

func configsEqual(a, b CameraSettings) bool {
	if math.Abs(a.FPS-b.FPS) > 0.001 {
		return false
	}
	return a.Shutter == b.Shutter &&
		a.TimecodeMode == b.TimecodeMode &&
		a.TimecodeFrames == b.TimecodeFrames &&
		a.ISO == b.ISO &&
		a.WB == b.WB &&
		a.Resolution == b.Resolution &&
		a.RecordResolution == b.RecordResolution &&
		a.Codec == b.Codec &&
		a.Denoise == b.Denoise &&
		a.Anamorphic == b.Anamorphic &&
		a.ShutterMode == b.ShutterMode &&
		a.Metering == b.Metering &&
		a.Flicker == b.Flicker &&
		a.Sharpness == b.Sharpness &&
		a.Contrast == b.Contrast &&
		a.Saturation == b.Saturation &&
		a.Bitrate == b.Bitrate &&
		a.Kelvin == b.Kelvin &&
		a.AudioGain == b.AudioGain &&
		a.AudioEnabled == b.AudioEnabled &&
		a.AudioDevice == b.AudioDevice &&
		a.AudioFormat == b.AudioFormat &&
		a.Tint == b.Tint &&
		a.Container == b.Container &&
		a.Peaking == b.Peaking &&
		a.PeakingMono == b.PeakingMono &&
		a.Zebras == b.Zebras &&
		a.FalseColor == b.FalseColor &&
		a.Histogram == b.Histogram &&
		a.Grid == b.Grid
}

// generateThumbnail creates a jpg preview from a video file
func (a *App) generateThumbnail(videoPath string) {
	os.MkdirAll(filepath.Join("captures", "thumbnails"), 0755)

	// Robustly handle extensions
	base := filepath.Base(videoPath)
	ext := filepath.Ext(base)
	thumbName := strings.TrimSuffix(base, ext) + ".jpg"
	thumbPath := filepath.Join("captures", "thumbnails", thumbName)

	// ffmpeg -i video.mp4 -ss 00:00:00.500 -vframes 1 thumbnail.jpg
	args := []string{
		"-i", videoPath,
		"-ss", "00:00:00.500", // Grab frame at 0.5s
		"-vframes", "1",
		"-q:v", "5", // Quality 1-31 (lower is better)
		"-y",
		thumbPath,
	}

	cmd := exec.Command("ffmpeg", args...)
	if err := cmd.Run(); err != nil {
		fmt.Printf("Error generating thumbnail: %v\n", err)
	} else {
		fmt.Printf("Thumbnail generated: %s\n", thumbPath)
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
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".mp4") && !strings.HasSuffix(name, ".mkv") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Find thumbnail by replacing extension
		thumbName := name
		if strings.HasSuffix(name, ".mp4") {
			thumbName = strings.Replace(name, ".mp4", ".jpg", 1)
		} else if strings.HasSuffix(name, ".mkv") {
			thumbName = strings.Replace(name, ".mkv", ".jpg", 1)
		}

		thumbPath := filepath.Join("captures", "thumbnails", thumbName)
		thumbnail := ""
		if _, err := os.Stat(thumbPath); err == nil {
			thumbnail = "/captures/thumbnails/" + thumbName
		}

		// Get extension for label
		ext := "MP4"
		if strings.HasSuffix(name, ".mkv") {
			ext = "MKV"
		}

		files = append(files, FileInfo{
			Name:      name,
			Size:      info.Size(),
			Date:      info.ModTime().Format("2006-01-02 15:04"),
			Thumbnail: thumbnail,
			Extension: ext,
		})
	}

	return files
}

// DeleteCapture deletes a file and its thumbnail
func (a *App) DeleteCapture(name string) bool {
	os.Remove(filepath.Join("captures", name))

	thumbName := name
	if strings.HasSuffix(name, ".mp4") {
		thumbName = strings.Replace(name, ".mp4", ".jpg", 1)
	} else if strings.HasSuffix(name, ".mkv") {
		thumbName = strings.Replace(name, ".mkv", ".jpg", 1)
	}

	os.Remove(filepath.Join("captures", "thumbnails", thumbName))
	return true
}

// GetOS returns the current operating system
func (a *App) GetOS() string {
	return runtime.GOOS
}

// StartHeadlessServer provides access via standard browser
func (a *App) StartHeadlessServer() {
	mux := http.NewServeMux()

	// API Endpoints
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		stats := a.GetSystemStats()
		json.NewEncoder(w).Encode(stats)
	})

	mux.HandleFunc("/api/audio", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		levels := a.GetAudioLevels()
		json.NewEncoder(w).Encode(levels)
	})

	mux.HandleFunc("/api/audio/devices", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a.ListAudioDevices())
	})

	mux.HandleFunc("/api/wifi/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a.GetWifiStatus())
	})

	mux.HandleFunc("/api/wifi/scan", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a.ScanWifiNetworks())
	})

	mux.HandleFunc("/api/wifi/connect", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "method not allowed"})
			return
		}

		var req struct {
			SSID     string `json:"ssid"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "invalid payload"})
			return
		}

		fmt.Printf("Wi-Fi connect request: ssid=%q passwordProvided=%t\n", strings.TrimSpace(req.SSID), strings.TrimSpace(req.Password) != "")

		success := a.ConnectWifi(req.SSID, req.Password)
		json.NewEncoder(w).Encode(map[string]any{"success": success})
	})

	mux.HandleFunc("/api/wifi/hotspot/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a.GetHotspotStatus())
	})

	mux.HandleFunc("/api/wifi/hotspot/start", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "method not allowed"})
			return
		}
		var req struct {
			SSID     string `json:"ssid"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "invalid payload"})
			return
		}
		success := a.StartHotspot(req.SSID, req.Password)
		json.NewEncoder(w).Encode(map[string]any{"success": success})
	})

	mux.HandleFunc("/api/wifi/hotspot/stop", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "method not allowed"})
			return
		}
		success := a.StopHotspot()
		json.NewEncoder(w).Encode(map[string]any{"success": success})
	})

	mux.HandleFunc("/api/stream/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(a.GetStreamingStatus())
	})

	mux.HandleFunc("/api/stream/start", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "method not allowed"})
			return
		}
		success := a.StartStreaming()
		json.NewEncoder(w).Encode(map[string]any{"success": success})
	})

	mux.HandleFunc("/api/stream/stop", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(map[string]any{"success": false, "error": "method not allowed"})
			return
		}
		success := a.StopStreaming()
		json.NewEncoder(w).Encode(map[string]any{"success": success})
	})

	mux.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost {
			var s CameraSettings
			if err := json.NewDecoder(r.Body).Decode(&s); err == nil {
				a.UpdateConfig(s)
			}
		}
		a.settingsLock.Lock()
		s := a.settings
		a.settingsLock.Unlock()
		json.NewEncoder(w).Encode(s)
	})

	mux.HandleFunc("/api/record", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		recording := a.ToggleRecording()
		json.NewEncoder(w).Encode(map[string]bool{"recording": recording})
	})

	mux.HandleFunc("/api/captures", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodDelete {
			name := r.URL.Query().Get("name")
			success := a.DeleteCapture(name)
			json.NewEncoder(w).Encode(map[string]bool{"success": success})
			return
		}
		files := a.ListCaptures()
		json.NewEncoder(w).Encode(files)
	})

	// Static Files from Embedded Assets
	dist, err := fs.Sub(a.assets, "frontend/dist")
	if err != nil {
		fmt.Printf("FS Sub Error: %v\n", err)
	}

	// Debug Endpoint
	mux.HandleFunc("/api/debug/fs", func(w http.ResponseWriter, r *http.Request) {
		var files []string
		fs.WalkDir(dist, ".", func(path string, d fs.DirEntry, err error) error {
			if err == nil {
				files = append(files, fmt.Sprintf("%s (dir: %v)", path, d.IsDir()))
			}
			return nil
		})
		json.NewEncoder(w).Encode(files)
	})

	mux.HandleFunc("/stream", a.handleStream)
	mux.HandleFunc("/frame.jpg", a.handleFrame)
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("pong"))
	})

	fileServer := http.FileServer(http.FS(dist))

	// Serve actual video files from the captures directory
	os.MkdirAll("captures", 0755)
	mux.Handle("/captures/", http.StripPrefix("/captures/", http.FileServer(http.Dir("captures"))))

	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

		path := r.URL.Path

		// Skip logging for frequent API/Stream calls
		if path != "/api/stats" && path != "/api/audio" && path != "/api/audio/devices" && path != "/stream" {
			fmt.Printf("HTTP %s: %s\n", r.Method, path)
		}

		cleanPath := strings.TrimPrefix(path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		f, err := dist.Open(cleanPath)
		if err != nil {
			if !strings.Contains(cleanPath, ".") && !strings.HasPrefix(cleanPath, "api/") {
				fmt.Printf("  -> SPA Fallback to index.html\n")
				r.URL.Path = "/"
				fileServer.ServeHTTP(w, r)
				return
			}
			fmt.Printf("  -> 404 Not Found\n")
			http.NotFound(w, r)
			return
		}
		f.Close()

		// Explicit MIME types are crucial for ESM modules in browsers
		if strings.HasSuffix(cleanPath, ".js") {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		} else if strings.HasSuffix(cleanPath, ".css") {
			w.Header().Set("Content-Type", "text/css; charset=utf-8")
		} else if strings.HasSuffix(cleanPath, ".html") {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
		}

		fileServer.ServeHTTP(w, r)
	}))

	fmt.Println("-------------------------------------------")
	fmt.Println("PiCam V2 Headless Server")
	fmt.Println("Control UI: http://<pi-ip>:8080")
	fmt.Println("MJPEG Stream: http://<pi-ip>:8080/stream")
	fmt.Println("-------------------------------------------")

	a.server = &http.Server{Addr: ":8080", Handler: mux}
	if err := a.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Printf("FATAL: Headless server failed: %v\n", err)
	}
}

func (a *App) Shutdown() {
	a.shutdownOnce.Do(func() {
		close(a.stopCh)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if a.server != nil {
		_ = a.server.Shutdown(ctx)
	}

	a.cmdMu.Lock()
	cam := a.cmd
	a.cmd = nil
	a.cmdMu.Unlock()
	terminateCmd(cam)

	a.settingsLock.Lock()
	if a.isRecording {
		a.toggleRecordingInternal()
	}
	a.settingsLock.Unlock()

	a.stopMediaMTXPublisher()
	a.stopMediaMTXServer()
	cleanupOrphanProcesses()
}

func (a *App) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	m := multipart.NewWriter(w)
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary="+m.Boundary())
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	child := make(chan []byte, 1)
	a.listenersMu.Lock()
	a.listeners = append(a.listeners, child)
	a.listenersMu.Unlock()

	defer func() {
		a.listenersMu.Lock()
		for i, listener := range a.listeners {
			if listener == child {
				a.listeners = append(a.listeners[:i], a.listeners[i+1:]...)
				break
			}
		}
		a.listenersMu.Unlock()
	}()

	frameTicker := time.NewTicker(time.Second / 20) // cap MJPEG push rate
	defer frameTicker.Stop()

	var latest []byte

	for {
		select {
		case frame := <-child:
			latest = frame

		case <-frameTicker.C:
			if latest == nil {
				continue
			}

			for {
				select {
				case frame := <-child:
					latest = frame
				default:
					goto writeFrame
				}
			}

		writeFrame:
			header := make(textproto.MIMEHeader)
			header.Set("Content-Type", "image/jpeg")
			header.Set("Content-Length", fmt.Sprintf("%d", len(latest)))
			mw, err := m.CreatePart(header)
			if err != nil {
				return
			}
			_, err = mw.Write(latest)
			if err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (a *App) handleFrame(w http.ResponseWriter, r *http.Request) {
	a.latestFrameMu.RLock()
	if len(a.latestFrame) == 0 {
		a.latestFrameMu.RUnlock()
		http.Error(w, "frame not ready", http.StatusServiceUnavailable)
		return
	}
	frame := append([]byte(nil), a.latestFrame...)
	a.latestFrameMu.RUnlock()

	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(frame)))
	_, _ = w.Write(frame)
}
