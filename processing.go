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

	// Threshold for edge detection (adjusted for better sensitivity)
	const threshold = 15000

	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			idx := src.PixOffset(x, y)
			r := int(src.Pix[idx])
			g := int(src.Pix[idx+1])
			b := int(src.Pix[idx+2])

			// Luminance * 1000 to keep it integer
			lVal := r*299 + g*587 + b*114
			lum[y*width+x] = lVal

			if histogram != nil && len(histogram) >= 256 {
				histogram[lVal/1000]++
			}
		}
	}

	// Simple Laplacian filter:
	// [ 0 -1  0 ]
	// [-1  4 -1 ]
	// [ 0 -1  0 ]
	for y := 1; y < height-1; y++ {
		for x := 1; x < width-1; x++ {
			center := lum[y*width+x]

			// Laplacian
			sum := center*4 - lum[(y-1)*width+x] - lum[(y+1)*width+x] - lum[y*width+(x-1)] - lum[y*width+(x+1)]

			if sum > threshold || sum < -threshold {
				idx := src.PixOffset(x, y)
				src.Pix[idx] = 255 // R
				src.Pix[idx+1] = 0 // G
				src.Pix[idx+2] = 0 // B
				// Keep A as is
			}
		}
	}
}
