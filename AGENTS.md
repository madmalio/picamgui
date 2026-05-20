# PiCam V2 - Development Status & Architecture

This document summarizes the current state of the professional cinema-style camera GUI built for the Raspberry Pi 4 and HQ Camera module.

## Tech Stack
- **Backend:** Go (Wails + Headless HTTP Server)
- **Frontend:** React + TailwindCSS v4 + Framer Motion
- **Icons:** Lucide React
- **Streaming:** MJPEG over local HTTP (Port 8080/stream)
- **OS Target:** Raspberry Pi OS Lite (64-bit Bookworm)

## Architecture Overview
The application uses a **"Dual-Path" Architecture** to support seamless development on Windows while targeting hardware-specific features on the Raspberry Pi 4.

- **Mock Mode (Windows):** Detects `GOOS == "windows"` and serves simulated camera frames and telemetry.
- **Production Mode (Linux/Pi):** Interfaces with `rpicam-vid` via standard pipes for low-latency preview and hardware-accelerated H.264 recording.
- **Headless Pivot:** Optimized to run without a GUI on the Pi (via `-tags headless`), serving the control interface to any remote browser on the network.

## Features Implemented

### 1. Professional HUD & Telemetry
- **High-Visibility HUD:** High-contrast labels for FPS, ISO, Shutter, WB, and Tint.
- **Contextual Quick Picker:** Vertical selection menus that open directly below the setting being adjusted.
- **180° Shutter Rule:** Automatic calculation of shutter speed based on frame rate.
- **Persistence:** All settings and overlay states (including Tint, Grid, and Histogram) are saved to `settings.json` and persist across restarts.

### 2. Pro Monitoring Tools (Backend Processed)
- **Real Focus Peaking:** Laplacian edge detection implemented in Go with optional "Peaking Mono" (B&W) mode.
- **Zebra Stripes:** Animated moving diagonal stripes appearing on areas >92% luminance.
- **Technical False Color:** Mapped luminance zones (Red=Clip, Green=Skin, Magenta=Mid-Gray) for precise exposure.
- **Real-time Histogram:** High-speed (150ms) colored luminance distribution with reference lines (shadows, mids, highlights).
- **Grid Guides:** 3x3 Rule of Thirds overlay with high-visibility lines.

### 3. Settings & Configuration
- **Hardware Integration:** Real-time hot-restarting of the camera process when exposure/FPS settings change.
- **Manual WB:** Kelvin selection (2500K - 10000K) mapped to real IMX477 RGB gains.
- **Headless Server:** Full control API and asset serving baked into a single binary.
- **Resolution Split (Latest):** Preview resolution and recording resolution are now independent settings. This allows low-latency preview (e.g. 720p) while recording at a separate target resolution.
- **1080p Source Preservation (Latest):** Camera source resolution now elevates to 1080p automatically when recording target or streaming target is 1080p, preventing costly 720->1080 upscale in record/stream paths while preserving HD detail at output.
- **Source-Resolution Activation Guard (Latest):** 1080p source elevation for streaming now keys off active publisher state (not merely persisted stream-enable setting), preventing unnecessary thermal load when streaming is disabled/stopped.
- **Resolution Guardrails (Latest):** UI and backend now limit preview/record selections to 720p and 1080p for Pi 4 reliability; legacy 2K/4K saved values are clamped to 1080p on load/update.
- **Wi-Fi Management (Latest):** Settings now include a Network page that can scan nearby SSIDs, show current Wi-Fi status, and issue connection commands via `nmcli` on Linux/Pi.
- **Wi-Fi Status Sync (Latest):** Network status refresh is now centralized in the frontend and reused after scan/connect actions, eliminating stale "Not connected" labels when scan cards show an active SSID.
- **HUD Wi-Fi Indicator (Latest):** Main preview UI now shows a live Wi-Fi state icon/label so operators can confirm connectivity without opening Settings.
- **HUD Wi-Fi Indicator Simplification (Latest):** Main preview UI Wi-Fi indicator is now icon-only (no SSID text) to reduce HUD clutter while still conveying connectivity state by color.
- **HUD CPU Temp Indicator (Latest):** Main preview UI now shows live CPU temperature on the HUD with color-threshold status for quick thermal awareness without opening Settings.
- **Record-Run Timecode (Latest):** Main HUD timecode now behaves as persistent record-run (advances only while recording, holds on stop, and resumes from last value on next take) with frame count persisted in settings.
- **Record-Run Timecode Reset (Latest):** Recording settings now include a "Reset TC" action to zero persisted record-run frames and restart timecode from `00:00:00:00`.
- **Record-Run Timecode Accuracy (Latest):** Timecode frame persistence now updates from backend-written recording frames (plus config refresh after record toggle), improving match between displayed timecode and finalized clip duration.
- **Recording Continuity Tuning (Latest):** Recorder writer now uses continuity-first paced output (FIFO-at-tick with last-frame hold when source starves) to reduce visible skips/micro-jumps at 30fps under transient load.
- **Recording Stop-Finalize Flush (Latest):** On record stop, backend now waits briefly based on queued recorder frames before closing ffmpeg pipe, improving alignment between wall-clock take duration and finalized clip duration.
- **Recording Stop-Finalize Flush (Latest):** On record stop, backend now waits briefly based on queued recorder frames, performs a short final recorder-queue drain write pass, then closes ffmpeg pipe to better align finalized clip duration with take time (especially at 1080p30).
- **FPS/Resolution Guardrails (Latest):** Backend now enforces `1080p <= 30fps` while allowing 60fps only on 720p preview; frontend FPS picker dynamically hides unsupported rates for the selected preview resolution.
- **Timecode FPS-Switch Normalization (Latest):** When changing FPS while not recording, frontend rescales persisted record-run frame count to keep elapsed time stable and prevent minute/second jumps.
- **Timecode Reload Stability (Latest):** Frontend now seeds FPS-normalization state from backend config on load and defers normalization until initialization completes, preventing unintended timecode jumps after page refresh.
- **Wi-Fi Poll Scope (Latest):** Periodic Wi-Fi status polling now runs only while the Settings overlay is open on the Network tab (plus initial load), reducing unnecessary background API traffic.
- **Wi-Fi Poll Scope (Latest):** Periodic Wi-Fi status polling is now disabled while on the Network tab; status refresh runs on initial entry and explicit actions (scan/connect) to avoid scan-time `nmcli` contention on Pi.
- **Wi-Fi Status Detection Hardening (Latest):** Backend Wi-Fi status now accepts both `wifi` and `802-11-wireless` connection types and falls back to active scan/device-state parsing, reducing false "Not connected" status when scan cards show active SSIDs.
- **Wi-Fi SSID Normalization (Latest):** Backend now strips Netplan connection-profile prefixes (e.g. `netplan-wlan0-`) from displayed Wi-Fi names so UI shows human SSID labels.
- **Wi-Fi Scan Hardening (Latest):** Network scanning now targets the active Wi-Fi interface with delayed retry and falls back to `iw dev <iface> scan` parsing when `nmcli` returns only sparse results.
- **Wi-Fi Scan Privilege/Power Hardening (Latest):** Sparse-scan fallback now disables Wi-Fi power-save (`iw ... power_save off`) and attempts privileged `iw`/`iwlist` scan commands (`sudo -n`) when unprivileged scans return no data.
- **Wi-Fi Scan Discovery (Latest):** After enabling passwordless sudo for `iw`/`iwlist` scan commands on Pi, Network scan now discovers nearby SSIDs beyond the currently connected AP.
- **Wi-Fi Connect Auth Fallback (Latest):** When `nmcli` connect fails with "Not authorized to control networking," backend now attempts non-interactive `sudo -n nmcli ...` fallback before returning failure.
- **Wi-Fi Connect Interface Targeting (Latest):** Wi-Fi connect commands now include explicit interface targeting (`ifname <wifi-iface>`) to improve reliability when nmcli cannot resolve SSIDs without device scope.
- **Wi-Fi Connect Key-Management Fallback (Latest):** When direct `nmcli device wifi connect` fails with missing `key-mgmt`, backend now retries via explicit connection profile creation (`wifi-sec.key-mgmt=wpa-psk`, `wifi-sec.psk=<password>`) before returning failure.
- **Wi-Fi Scan Merge Hardening (Latest):** Backend scan now retries interface-targeted `nmcli` and merges (`nmcli` + `iw` + `iwlist`) results instead of replacing with a single-source sparse list, improving multi-SSID discovery reliability.
- **Wi-Fi Scan Runtime Determinism (Latest):** Privileged scan fallbacks now prefer `sudo -n` absolute-path command variants first (`/usr/sbin/iw`, `/usr/sbin/iwlist`), with explicit per-attempt error filtering/logging so sparse/permission-noise outputs are not treated as valid scan results.
- **Wi-Fi Selection Persistence (Latest):** Frontend Wi-Fi status refresh no longer overwrites manually selected SSIDs in the Network tab, preventing scan-card target selection from being replaced by currently connected AP during polling.
- **Wi-Fi Connect Trace Logging (Latest):** Backend now logs submitted Wi-Fi connect request SSID and whether a password was provided (`/api/wifi/connect`) to speed Pi-side debugging.
- **Wi-Fi Scan UI Resilience (Latest):** Frontend now preserves prior scan results when a scan returns an empty list, pauses status polling while scan/connect actions are in progress, and avoids immediate post-scan status refresh to reduce `nmcli` contention.
- **Wi-Fi Sudoers Portability (Latest):** Deployment guidance should use placeholders (e.g. `<app_user>`) and absolute binary paths in sudoers examples instead of hardcoded usernames, so scan/connect privilege setup is reusable across installs.
- **Wi-Fi Network UX Polish (Latest):** Network tab now surfaces a cleaner status/selection block, network-count helper, empty-state card, and centered toast notifications for scan/connect outcomes to provide immediate operator feedback.
- **Hotspot Fallback Mode (Latest):** Backend now supports hotspot start/stop/status via NetworkManager (`nmcli`) with sudo fallback, plus boot-time auto-fallback (fixed timeout + disconnected check) that enables a Pi-hosted AP for direct control when no Wi-Fi client connection is available.
- **Network Mode Control UX (Latest):** Network tab now includes hotspot SSID/password controls, manual start/stop actions, and an `Auto Hotspot` toggle persisted in settings for field-recovery workflows.
- **MediaMTX Streaming Control (Latest):** Settings now include a dedicated Streaming tab with runtime enable/disable controls, stream-audio toggle, status/readout, and start/stop actions wired to backend streaming APIs.
- **MediaMTX 1080p Audio Path (Latest):** Publisher now targets clean 1080p RTSP output (`rtsp://<pi-ip>:8554/<path>`), attempts USB audio inclusion, and falls back to video-only publish if audio input initialization fails.
- **USB Audio Preflight Relaxation (Latest):** Audio-device preflight now warns but still attempts the audio publisher path before falling back, avoiding false "unavailable" detections on valid USB inputs.
- **WebRTC Audio Compatibility (Latest):** Stream publisher audio codec is now Opus (`libopus`) with async resampling for MediaMTX WebRTC compatibility, preventing WebRTC sessions from skipping AAC tracks.
- **MediaMTX Daemon Lifecycle (Latest):** Streaming start/stop now also manages MediaMTX server process lifecycle from the app, reducing "publisher running without server" failures during dev/operator use.
- **Streaming Manual-Start Guard (Latest):** Streaming no longer auto-starts from persisted settings/config updates; MediaMTX server and publisher now start only via explicit `Start Stream` action (unless env-forced publisher mode is enabled).
- **Streaming Delivery UX (Latest):** Streaming tab now includes polished server/publisher state cards plus a delivery selector (`WebRTC` low-latency vs `RTSP` ingest) with protocol-specific endpoint readout.
- **Audio Capture Contention Guard (Latest):** Live ALSA VU sampling now pauses while streaming-audio publish is active to avoid capture-device contention that can cause missing live stream audio.
- **Streaming Stability Rollback (Latest):** Runtime 1080p source-elevation coupling and mode-transition camera restarts were rolled back to restore stable 720p preview/source behavior and reliable recording timing while MediaMTX integration is paused for a cleaner reintroduction pass.

### 4. Media & Storage
- **Recording Engine:** Hardware-accelerated H.264 recording via `ffmpeg` using the Pi's `h264_v4l2m2m` encoder. Supports dynamic resolution (720p/1080p/2K/4K) and dual container support (**MP4** and **MKV**).
- **Smooth Motion Architecture:** Uses a high-capacity buffered channel (1000 frames) and double-framerate synchronization to ensure recording playback speed perfectly matches real-time, even during disk I/O spikes.
- **Recording Timing Hardening (Latest):** Recording writer now uses wall-clock paced frame emission at target FPS and latest-frame queue draining to reduce "too fast" playback caused by bursty frame pipe writes.
- **Recording Quality Tuning (Latest):** Raised source MJPEG quality (currently `--quality 70`) and moved record scaling from `fast_bilinear` to `bicubic` to reduce macroblocking/pixelation at higher record resolutions.
- **Recording Encoder Stabilization (Latest):** Recorder now uses no B-frames (`-bf 0`), 1-second GOP cadence (`-g`/`-keyint_min` at FPS), bitrate-constrained VBV (`-maxrate`/`-bufsize`), and skips scaling when preview and record resolutions already match.
- **Recording Encoder Timing (Latest):** Recorder output now uses ffmpeg `-fps_mode passthrough` (without forced output `-r`/`-vsync cfr`) to reduce end-of-take duration compression from frame drop/re-timing.
- **Media Gallery:** Built-in browser for recorded clips with metadata, deletion confirmation modal, and full-screen video playback. Correctly labels and previews both MKV and MP4 files.
- **USB Audio Recording (Latest):** Recording pipeline now supports optional USB audio capture via ALSA (`hw:1,0` default) muxed into clips; AAC is supported in MP4/MKV, and 32-bit float audio (`pcm_f32le`) is supported via MKV.
- **USB Audio Fallback Hardening (Latest):** Recorder now preflights ALSA input availability (`arecord`) and falls back to video-only recording if the selected USB device is unavailable, preventing ffmpeg early-exit broken-pipe failures.
- **USB Audio Runtime Fallback (Latest):** Recorder startup now retries video-only mode if the audio-enabled ffmpeg path fails to initialize, reducing full-take failures when USB audio capture is unstable.
- **USB Audio Preflight Relaxation (Latest):** Audio-device preflight now warns but still attempts the audio recorder path before falling back, avoiding false "unavailable" detections on valid USB inputs.
- **USB Audio Arg-Order Fix (Latest):** Recorder ffmpeg arguments now place ALSA input options before output codec/bitrate options, fixing audio-input parse failures like "Option b:v ... cannot be applied to input url".
- **Audio Sidecar Mux Path (Latest):** Recording now captures video via ffmpeg video-only path and records USB audio as a separate sidecar track, then muxes video+audio on finalize to reduce dual-input real-time instability.
- **Audio Sidecar Capture Engine (Latest):** Sidecar audio capture now uses ffmpeg ALSA input (instead of `arecord`) and emits astats-derived level telemetry for in-record meter updates without opening a second capture client.
- **Audio Sidecar Mux Hardening (Latest):** Sidecar mux now writes to an extension-preserving temp output path before replace and logs ffmpeg mux stderr on failure for faster diagnosis.
- **Audio Sidecar Process Guard (Latest):** Sidecar audio capture now serializes against ALSA meter sampling and uses a tracked stop/wait handshake, reducing cases where subsequent takes lose audio due to lingering capture process state.
- **Audio Sidecar Stop Robustness (Latest):** Sidecar stop/wait now uses per-process done channels with bounded kill/exit waits, preventing finalize hangs when audio capture ignores graceful stop.
- **Finalize UX (Latest):** Frontend now shows a temporary "Finalizing recording..." overlay when stopping a take so operators know mux/finalization is in progress.
- **Audio Sidecar Stop Robustness (Latest):** Sidecar stop now stages `INT -> TERM -> KILL` with bounded waits to improve end-of-take audio closure and reduce forced-kill truncation.
- **Recording Stop-Finalize Flush (Latest):** On record stop, backend now waits briefly based on queued recorder frames, performs a short final recorder-queue drain write pass, then closes ffmpeg pipe to better align finalized clip duration with take time (especially at 1080p30).
- **Timecode Stop Clamp (Latest):** Frontend now prevents post-stop config refresh from reducing displayed record-run frame count, avoiding visible backward timecode jumps right after stop.
- **Recorder Buffer Integrity (Latest):** Recording queue now enqueues deep-copied MJPEG frames to avoid buffer-reuse corruption that can cause malformed JPEG packets (`EOI missing`) and unstable encode behavior.
- **Recorder Stop Handshake (Latest):** Record stop now uses a single-writer stop signal + writer-done wait before closing ffmpeg stdin, reducing close/write races (`file already closed`) and improving output stability.
- **Recording Stop-Finalize Flush (Latest):** On record stop, backend now waits briefly based on queued recorder frames, performs a short final recorder-queue drain write pass, then closes ffmpeg pipe to better align finalized clip duration with take time (especially at 1080p30).
- **Recording Encoder Timing (Latest):** Recorder output now uses ffmpeg `-fps_mode passthrough` (without forced output `-r`/`-vsync cfr`) to reduce end-of-take duration compression from frame drop/re-timing.
- **USB Audio Device Picker (Latest):** Audio settings now load capture devices from `arecord -l` and allow selecting the active ALSA input (`plughw:X,Y`) directly in the UI.
- **Audio Monitoring (Latest):** Linux audio VU meters now sample real ALSA input (`arecord` raw capture + peak analysis) from the selected USB device instead of mock placeholder levels.
- **Audio Meter Consistency (Latest):** Idle (`arecord`) and in-record (`ffmpeg astats`) VU paths now share a common dBFS-to-meter response curve, improving low-level sensitivity when not recording and matching on-screen meter behavior across states.
- **Audio Meter Ballistics (Latest):** VU updates now apply light attack/release smoothing (fast rise, slower fall) in both idle and in-record paths for more stable, broadcast-style meter motion while preserving peak responsiveness.
- **Audio Capture Contention Guard (Latest):** Live ALSA VU sampling now pauses while recording is active to avoid capture-device contention with ffmpeg that can cause early-exit broken-pipe failures.
- **Audio Capture Start Guard (Latest):** Recorder start now serializes against ALSA VU sampling with a shared capture mutex to reduce race windows where meter sampling can steal the USB device at record start.
- **Auto-Thumbnails:** Real-time generation of JPG previews for every recorded clip (including MKV).
- **WYSIWYG Monitoring:** Preview uses `object-contain` to ensure framing exactly matches the recorded file, eliminating edge cropping.

## Current Project Structure
- `/app.go`: Main backend logic, MJPEG server, and API endpoints.
- `/processing.go`: High-performance image processing (Peaking, Zebras, False Color).
- `/headless_mode.go`: Entry point for non-GUI builds.
- `/desktop.go`: Entry point for Wails GUI builds.
- `/frontend/src/App.jsx`: Optimized React UI with backend bridge and technical overlays.

## Roadmap & Next Steps
- [x] **Real-time Monitoring:** Real edge detection and technical exposure tools.
- [x] **Settings Persistence:** Full disk-based saving of camera and HUD states.
- [ ] **MediaMTX Integration:** WebRTC low-latency streaming and RTSP support.
- [ ] **LUT Management:** Ability to upload and apply .cube files.
- [ ] **Audio Refinement:** Integration with ALSA/PulseAudio for real input monitoring.

## Current Known Issue (May 2026)
- **Publisher Lifecycle Instability (Linux/Pi):** When the MediaMTX publisher path is enabled, stopping/restarting the app can still leave camera-related child processes in a bad state. In this state, `rpicam-vid` may fail to recover without rebooting the Pi.
- **Observed Symptom:** After app stop/start or resolution changes, preview can fail to return until full system reboot.
- **Recent Hardening Attempt:** Added headless graceful shutdown (`app.Shutdown()`), startup/shutdown orphan cleanup (`pkill -f rpicam-vid` / `pkill -f ffmpeg`), and stop-signal aware goroutine exits to reduce camera restart races.
- **Latest Hardening Attempt:** Added stronger Linux child-process termination that explicitly kills command descendants (`pkill -P <pid>`) before restart/shutdown to reduce stale camera process trees.
- **Current Mitigation:** For critical shoots, prefer 720p preview and avoid rapid repeated resolution restarts when publisher is enabled. If lockup occurs, kill stale processes first, then restart app.
- **Development Mitigation:** Publisher is now opt-in via environment variable (`PICAM_ENABLE_PUBLISHER=1`). Default runtime keeps publisher disabled to avoid repeated Pi reboot cycles during rapid code/test loops.
- **Planned Fix Direction:** Decouple preview/record/publisher pipelines completely and move to deterministic process-group teardown + restart sequencing for Linux child processes.

## Current Known Issue (Wi-Fi UX, May 2026)
- **Status (Latest):** Fixed frontend stale-overwrite path where periodic status polling replaced manually selected SSID before connect submission.
- **Operator Verification:** Network tab now shows a "Selected network" label above connect status messaging for quick confirmation of the outgoing SSID.
- **Debug Path:** Backend logs connect payload trace (`ssid`, password-present bool) for `/api/wifi/connect` requests.

## Current Known Issue (Hotspot Fallback, May 2026)
- **Status (Latest):** Auto/manual hotspot fallback flow is implemented (NetworkManager `nmcli` AP path + retry logic), but AP broadcast is still unreliable on the current single-radio Pi 4 setup in field testing.
- **Working Theory:** Single onboard Wi-Fi radio limitations/driver behavior are constraining robust client/AP mode transitions under real boot/network conditions.
- **Bookmark / Next Step:** Revisit hotspot reliability after adding a second USB Wi-Fi adapter so client and AP roles can be split across separate interfaces.

## Current Known Issue (Binary Launch Integrity, May 2026)
- **Observed Symptom:** Headless binary occasionally failed immediately on launch with plain `Segmentation fault` (exit `139`) and no Go panic/traceback output.
- **Root-Cause Signal:** `strace` showed `execve("./picam-v2", ...) = -1 EFAULT (Bad address)` and `ldd ./picam-v2` also failed, indicating a corrupted/invalid executable artifact rather than app runtime logic.
- **Recovery Procedure:** Remove and fully rebuild binary (`rm ./picam-v2`, `go clean -cache -testcache -modcache`, `go build -a -tags headless -o picam-v2`), then verify with `file ./picam-v2` before run.

## Mobile Client Direction (May 2026)
- **Current Direction:** PWA/Caddy path removed from repo and runtime workflow.
- **Next Step:** Build an Android WebView shell that can connect to and control multiple PiCam instances over LAN.

## Migration Bookmark (May 2026)
- **Decision:** Preserve the current stable recording/preview workflow and perform MediaMTX camera-ownership migration in an isolated split (separate git branch and optionally separate working clone).
- **Reasoning:** Recent stream coupling tests impacted recording reliability, timing, and thermals; split-path development reduces regression risk while allowing focused streaming experiments.
- **Next Session Plan:** Create a migration branch (e.g. `feature/mediamtx-first`) for video-only MediaMTX camera-source validation first, then reintroduce audio/control mapping in phases after baseline stability checks.

## Dev Deploy Commands (Windows -> Pi)
- **Frontend dist sync:** `scp -r .\frontend\dist mark@192.168.8.146:~/picam-v2/frontend/`
- **Single file sync:** `scp .\app.go mark@192.168.8.146:~/picam-v2/app.go`
- **Common Pi rebuild/run:** `cd ~/picam-v2 && go build -tags headless -o picam-v2 && pkill -f picam-v2 || true && ./picam-v2`

## Developer Workflow Note (Windows Primary)
- **Host model:** Development edits happen on Windows; deployment/test runs happen on Raspberry Pi via `scp` + on-device rebuild/run.
- **When frontend UI changes:** Rebuild on Windows (`cd frontend && npm run build`) and sync `frontend/dist` to Pi.
- **When backend Go changes:** Sync changed `.go` file(s) (at minimum `app.go` when touched), then rebuild on Pi.
- **Standard loop:** `scp` updated assets/files from Windows, then on Pi run `go build -tags headless -o picam-v2 && pkill -f picam-v2 || true && ./picam-v2`.
