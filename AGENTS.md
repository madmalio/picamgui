# PiCam V2 - Development Status & Architecture

This document summarizes the current state of the professional cinema-style camera GUI built for the Raspberry Pi 4 and HQ Camera module.

## Tech Stack
- **Backend:** Go + Wails
- **Frontend:** React + TailwindCSS v4 + Framer Motion
- **Icons:** Lucide React
- **Streaming:** MJPEG over local HTTP (Port 8081)

## Architecture Overview
The application uses a **"Dual-Path" Architecture** to support seamless development on Windows while targeting hardware-specific features on the Raspberry Pi 4.

- **Mock Mode (Windows):** Detects `GOOS == "windows"` and serves simulated camera frames, system telemetry, and dummy recording files.
- **Production Mode (Linux/Pi):** Designed to interface with `rpicam-apps` (`libcamera`) via pipes for low-latency preview and hardware-accelerated recording.

## Features Implemented

### 1. Professional HUD & Telemetry
- **Dynamic Telemetry:** Real-time readouts for FPS, ISO, Shutter, WB, and Tint.
- **Quick Picker:** On-screen selection bars for instant adjustments without entering menus.
- **180° Shutter Rule:** Automatic shutter speed calculation based on frame rate.

### 2. Monitoring Tools
- **Focus Peaking:** Hardware-accelerated SVG filter highlighting sharp edges in red.
- **Zebras:** CSS-based diagonal stripes for highlight clipping warnings.
- **False Color:** Luminance-mapped thermal-style exposure aid with on-screen legend.
- **Histogram:** Real-time animated luminance distribution graph.
- **Grid Guides:** Simplified Rule of Thirds and Center Crosshair.

### 3. Settings & Configuration
- **Tabbed Interface:** Organized into Camera, Record, Monitor, and System.
- **Hardware Aware:** Limits and presets aligned with the IMX477 sensor and Pi 4 encoding capabilities (e.g., H.264 HW acceleration).
- **Manual Control:** Full Manual WB with Kelvin selection (2500K - 10000K) and Tint adjustment.

### 4. Media & Storage
- **Media Gallery:** Built-in browser for recorded clips with file metadata (size, date) and delete functionality.
- **Storage Tracking:** Real-time disk space telemetry integrated into the HUD.
- **Recording Engine:** Timestamped file generation with pulsing recording indicators.

### 5. System Health
- **Live Gauges:** Monitoring CPU Temperature, System Voltage, and Memory usage to prevent thermal throttling or power issues on the Pi 4.

## Current Project Structure
- `/app.go`: Main backend logic, HTTP stream server, and system statistics.
- `/main.go`: Wails application entry point.
- `/frontend/src/App.jsx`: Main UI component containing all layouts and overlay logic.
- `/frontend/src/style.css`: Tailwind v4 configuration and custom camera aesthetics.

## Roadmap & Next Steps
- [x] **Audio Support:** Integration of mock VU meters and gain controls.
- [x] **False Color & HUD:** Decoupled toggles and professional luminance legend.
- [x] **Real Focus Peaking:** Implementing edge detection algorithm in the Go backend for better performance on Pi.
- [ ] **LUT Management:** Ability to upload and apply .cube files to the preview/file.
- [ ] **MediaMTX Integration:** External RTSP/WebRTC streaming.
