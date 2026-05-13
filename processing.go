package main

import (
	"image"
)

// ApplyFocusPeaking applies a simple Laplacian edge detection and overlays it in red.
// It uses the provided lum buffer and updates the histogram if provided.
func ApplyFocusPeaking(src *image.RGBA, lum []int, histogram []int) {
	if src == nil {
		return
	}

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if len(lum) < width*height {
		return
	}

	// Reset histogram if provided
	if histogram != nil && len(histogram) >= 256 {
		for i := range histogram {
			histogram[i] = 0
		}
	}

	// Optimized luminance calculation and histogram update
	pix := src.Pix
	for y := 0; y < height; y++ {
		offset := y * width
		pixOffset := y * src.Stride
		for x := 0; x < width; x++ {
			idx := pixOffset + x*4
			r := int(pix[idx])
			g := int(pix[idx+1])
			b := int(pix[idx+2])

			// Luminance * 1000
			lVal := r*299 + g*587 + b*114
			lum[offset+x] = lVal

			if histogram != nil {
				histogram[lVal/1000]++
			}
		}
	}

	// Threshold for edge detection
	const threshold = 15000

	// Laplacian filter
	for y := 1; y < height-1; y++ {
		offset := y * width
		pixOffset := y * src.Stride
		for x := 1; x < width-1; x++ {
			center := lum[offset+x]

			// Laplacian
			sum := center*4 - lum[offset-width+x] - lum[offset+width+x] - lum[offset+x-1] - lum[offset+x+1]

			if sum > threshold || sum < -threshold {
				idx := pixOffset + x*4
				pix[idx] = 255 // R
				pix[idx+1] = 0 // G
				pix[idx+2] = 0 // B
			}
		}
	}
}

// UpdateHistogramOnly calculates the luminance distribution without modifying the image.
func UpdateHistogramOnly(src *image.RGBA, histogram []int) {
	if src == nil || histogram == nil || len(histogram) < 256 {
		return
	}

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()

	for i := range histogram {
		histogram[i] = 0
	}

	pix := src.Pix
	stride := src.Stride
	// Sample every 8th pixel for maximum speed (64x less work)
	for y := 0; y < height; y += 8 {
		pixOffset := y * stride
		for x := 0; x < width; x += 8 {
			idx := pixOffset + x*4
			r := int(pix[idx])
			g := int(pix[idx+1])
			b := int(pix[idx+2])

			lVal := (r*299 + g*587 + b*114) / 1000
			if lVal > 255 {
				lVal = 255
			}
			histogram[lVal]++
		}
	}
}
