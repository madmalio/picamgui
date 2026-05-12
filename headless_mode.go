//go:build headless

package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func RunApp(app *App) {
	fmt.Println("Running in HEADLESS mode (No GUI dependencies)...")

	// Initialize backend logic (passing nil context as Wails isn't running)
	go app.startup(nil)

	// Start the web server
	app.StartHeadlessServer()

	// Wait for interrupt to keep the app alive
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan
}
