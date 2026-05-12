package main

import (
	"embed"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp(assets)

	// RunApp is defined in desktop.go or headless_mode.go depending on build tags
	RunApp(app)
}
