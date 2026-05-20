package main

import (
	"image"
)

// MonitoringSettings passed to processing functions
type MonitoringSettings struct {
	Peaking    bool
	Zebras     bool
	FalseColor bool
	Histogram  bool
}

// ProcessImage handles all active monitoring tools in an optimized way
func ProcessImage(src *image.RGBA, settings MonitoringSettings, lum []int, histogram []int, frameCount int) {
	if src == nil {
		return
	}

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if len(lum) < width*height {
		return
	}

	// 1. Reset histogram if needed
	if settings.Histogram && histogram != nil && len(histogram) >= 256 {
		for i := range histogram {
			histogram[i] = 0
		}
	}

	// 2. Pre-calculate luminance and update histogram in one pass
	pix := src.Pix
	stride := src.Stride

	// We always need luminance for peaking, zebras, or false color
	needLum := settings.Peaking || settings.Zebras || settings.FalseColor || settings.Histogram

	if needLum {
		for y := 0; y < height; y++ {
			rowOffset := y * width
			pixOffset := y * stride
			for x := 0; x < width; x++ {
				idx := pixOffset + x*4
				r := int(pix[idx])
				g := int(pix[idx+1])
				b := int(pix[idx+2])

				// Luminance * 1000
				lVal := r*299 + g*587 + b*114
				lum[rowOffset+x] = lVal

				if settings.Histogram && histogram != nil {
					// Sample every 4th pixel for histogram if only histogram is active
					// But if we are already iterating for other tools, might as well do all
					if !settings.Peaking && !settings.Zebras && !settings.FalseColor {
						if x%4 == 0 && y%4 == 0 {
							histogram[lVal/1000]++
						}
					} else {
						// Full sampling if we are already here
						if x%2 == 0 && y%2 == 0 {
							histogram[lVal/1000]++
						}
					}
				}
			}
		}
	}

	// 3. Apply Overlays
	// Note: We iterate again but only for the active pixels.
	// To be even faster we could do this in the first pass, but it would make the code messy.

	if settings.FalseColor {
		ApplyFalseColorPass(src, lum, width, height)
		// Usually if False Color is on, we don't show Zebras as it's redundant
	} else {
		if settings.Zebras {
			ApplyZebrasPass(src, lum, width, height, frameCount)
		}
	}

	if settings.Peaking {
		ApplyPeakingPass(src, lum, width, height)
	}
}

// ApplyPeakingPass uses the pre-calculated lum buffer
func ApplyPeakingPass(src *image.RGBA, lum []int, width, height int) {
	const threshold = 12000 // Slightly more sensitive
	pix := src.Pix
	stride := src.Stride

	for y := 1; y < height-1; y++ {
		row := y * width
		pixOffset := y * stride
		for x := 1; x < width-1; x++ {
			center := lum[row+x]
			// Laplacian
			sum := center*4 - lum[row-width+x] - lum[row+width+x] - lum[row+x-1] - lum[row+x+1]

			if sum > threshold || sum < -threshold {
				idx := pixOffset + x*4
				pix[idx] = 255 // R
				pix[idx+1] = 0 // G
				pix[idx+2] = 0 // B
			}
		}
	}
}

// ApplyZebrasPass adds moving diagonal stripes to overexposed areas
func ApplyZebrasPass(src *image.RGBA, lum []int, width, height int, frameCount int) {
	const threshold = 235 * 1000 // ~92% brightness
	pix := src.Pix
	stride := src.Stride

	// Shift pattern over time for "moving" effect
	shift := frameCount % 20

	for y := 0; y < height; y++ {
		row := y * width
		pixOffset := y * stride
		for x := 0; x < width; x++ {
			if lum[row+x] > threshold {
				// Diagonal stripe logic: (x + y + shift) % spacing
				if (x+y+shift)%20 < 10 {
					idx := pixOffset + x*4
					// Make it a high-contrast black/white zebra
					// or just darken the pixel to create the stripe
					pix[idx] = 0
					pix[idx+1] = 0
					pix[idx+2] = 0
				}
			}
		}
	}
}

// ApplyFalseColorPass maps luminance to a thermal-style exposure aid
func ApplyFalseColorPass(src *image.RGBA, lum []int, width, height int) {
	pix := src.Pix
	stride := src.Stride

	for y := 0; y < height; y++ {
		row := y * width
		pixOffset := y * stride
		for x := 0; x < width; x++ {
			l := lum[row+x] / 1000
			idx := pixOffset + x*4

			var r, g, b uint8
			switch {
			case l >= 250: // Clipping (100%+)
				r, g, b = 255, 0, 0 // Red
			case l >= 230: // Overexposed (90-100%)
				r, g, b = 255, 255, 0 // Yellow
			case l >= 128 && l <= 150: // Skin Tones (~55 IRE)
				r, g, b = 0, 255, 0 // Green
			case l >= 98 && l <= 108: // Middle Gray (~40 IRE)
				r, g, b = 255, 0, 255 // Magenta
			case l <= 25: // Near Black (0-10%)
				r, g, b = 0, 0, 255 // Blue
			case l <= 5: // Black
				r, g, b = 75, 0, 130 // Indigo/Purple
			default:
				// Grayscale for everything else
				val := uint8(l)
				r, g, b = val, val, val
			}

			pix[idx] = r
			pix[idx+1] = g
			pix[idx+2] = b
		}
	}
}

// kelvinToGains converts color temperature in Kelvin to Red and Blue gains.
func kelvinToGains(k int) (r, b float64) {
	if k < 2500 {
		return 3.0, 1.0
	}
	if k > 10000 {
		return 1.1, 3.2
	}

	if k <= 5600 {
		t := float64(k-2500) / (5600 - 2500)
		r = 3.0 + t*(1.7-3.0)
		b = 1.0 + t*(1.7-1.0)
	} else {
		t := float64(k-5600) / (10000 - 5600)
		r = 1.7 + t*(1.1-1.7)
		b = 1.7 + t*(3.2-1.7)
	}
	return r, b
}
