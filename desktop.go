//go:build !headless

package main

import (
	"fmt"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

func RunApp(app *App) {
	// In addition to Wails, we'll start a headless server on port 8080
	go app.StartHeadlessServer()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "picam-v2",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets: app.assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		fmt.Printf("Wails Error: %v\n", err)
	}
}
