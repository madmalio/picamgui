import React, { useState, useEffect, useCallback, memo, useMemo, useRef } from 'react';
import { 
  Camera, 
  Settings, 
  Play, 
  Circle, 
  Grid3X3, 
  Focus, 
  Wifi, 
  Mic2,
  Activity,
  X,
  HardDrive,
  Cpu,
  Eye,
  SlidersHorizontal,
  Thermometer,
  Zap,
  Box,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster, toast } from 'react-hot-toast';

const cn = (...inputs) => twMerge(clsx(inputs));

// --- Constants ---
const OPTIONS = {
  fps: [1, 12, 24, 25, 30, 48, 50, 60],
  shutter: ['1/25', '1/30', '1/48', '1/50', '1/60', '1/96', '1/100', '1/120', '1/250', '1/500', '1/1000'],
  iso: [100, 200, 400, 800, 1600, 3200],
  wb: ['Auto', 'Daylight', 'Cloudy', 'Tungsten', 'Fluorescent', 'Incandescent', 'Manual'],
  kelvin: [2500, 3200, 4300, 5000, 5600, 6500, 7500, 10000],
  tint: ['-50', '-25', '0', '+25', '+50'],
  resolution: ['720p', '1080p'],
  recordResolution: ['720p', '1080p'],
  codec: ['H.264 (HW)', 'ProRes (Experimental)', 'HEVC (Pi 5)'],
  bitrate: [10, 25, 50, 100],
  audioGain: [0, 25, 50, 75, 100],
  audioFormat: ['AAC', '32-bit Float'],
  flicker: ['Off', '50Hz', '60Hz'],
  anamorphic: ['1.0x', '1.33x', '1.5x', '2.0x'],
  lut: ['None', 'Rec.709', 'Film Log', 'Vivid'],
  container: ['MP4', 'MKV']
};

const getFpsOptions = (resolution) => {
  if (resolution === '1080p') {
    return OPTIONS.fps.filter((fps) => fps <= 30);
  }
  return OPTIONS.fps;
};

// --- Backend Bridge ---
const isWails = !!(window.go && window.go.main && window.go.main.App);

const callBackend = async (method, ...args) => {
  if (isWails) {
    return window.go.main.App[method](...args);
  }

  const endpoints = {
    GetSystemStats: '/api/stats',
    GetAudioLevels: '/api/audio',
    ListAudioDevices: '/api/audio/devices',
    GetWifiStatus: '/api/wifi/status',
    ScanWifiNetworks: '/api/wifi/scan',
    ConnectWifi: '/api/wifi/connect',
    StartHotspot: '/api/wifi/hotspot/start',
    StopHotspot: '/api/wifi/hotspot/stop',
    GetStreamingStatus: '/api/stream/status',
    StartStreaming: '/api/stream/start',
    StopStreaming: '/api/stream/stop',
    GetConfig: '/api/config',
    UpdateConfig: '/api/config',
    ToggleRecording: '/api/record',
    ListCaptures: '/api/captures',
    DeleteCapture: '/api/captures'
  };

  const url = endpoints[method];
  if (!url) return null;

  try {
    if (method === 'UpdateConfig') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args[0])
      });
      return res.json();
    }

    if (method === 'ConnectWifi' || method === 'StartHotspot' || method === 'StopHotspot' || method === 'StartStreaming' || method === 'StopStreaming') {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args[0] || {})
      });
      return res.json();
    }

    if (method === 'ToggleRecording') {
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      return data.recording;
    }

    if (method === 'DeleteCapture') {
      const res = await fetch(`${url}?name=${args[0]}`, { method: 'DELETE' });
      const data = await res.json();
      return data.success;
    }

    const res = await fetch(url);
    return res.json();
  } catch (err) {
    console.error(`API Error (${method}):`, err);
    throw err;
  }
};

const Histogram = memo(({ data = [] }) => {
  if (!data || data.length === 0) return <div className="w-48 h-16 glass rounded-lg" />;

  const max = Math.max(...data, 1) || 1;
  const height = 60;
  const width = 160;
  
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * (height - 5);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const areaPath = `M 0,${height} L ${points.join(' L ')} L ${width},${height} Z`;
  const linePath = `M ${points.join(' L ')}`;

  return (
    <div className="w-48 h-16 bg-black/60 backdrop-blur-md rounded-lg overflow-hidden border border-white/10 relative group">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="bm-hist-fill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" /> {/* Blue - Shadows */}
            <stop offset="30%" stopColor="#0ea5e9" stopOpacity="0.4" /> {/* Cyan - Low Mids */}
            <stop offset="70%" stopColor="#22c55e" stopOpacity="0.4" /> {/* Green - High Mids */}
            <stop offset="100%" stopColor="#eab308" stopOpacity="0.4" /> {/* Yellow - Highlights */}
          </linearGradient>
          <linearGradient id="bm-hist-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#60a5fa" />
            <stop offset="30%" stopColor="#38bdf8" />
            <stop offset="70%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#facc15" />
          </linearGradient>
        </defs>
        
        {/* Fill Area */}
        <path d={areaPath} fill="url(#bm-hist-fill)" className="transition-all duration-100 ease-out" />
        
        {/* Top Line */}
        <path d={linePath} fill="none" stroke="url(#bm-hist-line)" strokeWidth="1.5" className="transition-all duration-100 ease-out" />
        
        {/* Reference Lines */}
        <line x1={width * 0.18} y1="0" x2={width * 0.18} y2={height} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1={width * 0.5} y1="0" x2={width * 0.5} y2={height} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" strokeDasharray="2,2" />
        <line x1={width * 0.92} y1="0" x2={width * 0.92} y2={height} stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" strokeDasharray="2,2" />
      </svg>
      
      {/* Zone Markers Labels (Optional tiny text) */}
      <div className="absolute inset-0 flex justify-between px-1 pointer-events-none opacity-20">
        <span className="text-[6px] mt-auto mb-0.5">SHADOWS</span>
        <span className="text-[6px] mt-auto mb-0.5">MIDS</span>
        <span className="text-[6px] mt-auto mb-0.5">CLIP</span>
      </div>
    </div>
  );
});

const VUMeter = memo(({ levels = [0, 0] }) => (
  <div className="flex flex-col gap-1 w-full">
    {levels.map((level, i) => (
      <div key={i} className="h-1.5 bg-zinc-900 rounded-full overflow-hidden flex gap-0.5 p-[1px] relative">
        <motion.div 
          initial={false}
          animate={{ width: `${level * 100}%` }}
          transition={{ type: "spring", damping: 15, stiffness: 200 }}
          className={cn(
            "h-full rounded-full transition-colors",
            level > 0.9 ? "bg-red-500" : level > 0.7 ? "bg-yellow-500" : "bg-green-500"
          )}
        />
      </div>
    ))}
  </div>
));

const LivePreview = memo(({ isRecording, settings, orientation }) => {
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const videoRef = React.useRef(null);
  const requiresProcessedPreview = true;
  const streamUrl = isWails ? "http://localhost:8080/stream" : `${window.location.origin}/stream`;

  const webrtcBase = useMemo(() => {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:8889`;
  }, []);

  useEffect(() => {
    setError(false);
  }, [settings.fps, settings.iso, settings.shutter, settings.wb, settings.kelvin]);

  useEffect(() => {
    if (requiresProcessedPreview) return;

    let pc;
    let cancelled = false;

    const waitForIceGathering = (peer, timeoutMs = 2500) => new Promise((resolve) => {
      if (peer.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }, timeoutMs);

      const onStateChange = () => {
        if (peer.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          peer.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };

      peer.addEventListener('icegatheringstatechange', onStateChange);
    });

    const startWebRTC = async () => {
      try {
        if (!videoRef.current) return;

        pc = new RTCPeerConnection({
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require'
        });

        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.ontrack = (evt) => {
          if (cancelled || !videoRef.current) return;
          videoRef.current.srcObject = evt.streams[0];
          setError(false);
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);

        const offerSdp = pc.localDescription?.sdp || offer.sdp;
        const response = await fetch(`${webrtcBase}/picam/whep`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offerSdp
        });

        if (!response.ok) {
          throw new Error(`WHEP failed (${response.status}) at ${webrtcBase}/picam/whep`);
        }

        const answer = await response.text();
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });

        const connectTimeout = setTimeout(() => {
          if (!cancelled && pc && pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') setError(true);
        }, 5000);

        pc.oniceconnectionstatechange = () => {
          if (cancelled) return;
          const state = pc.iceConnectionState;
          if (state === 'connected' || state === 'completed') {
            clearTimeout(connectTimeout);
            setError(false);
          } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            clearTimeout(connectTimeout);
            setError(true);
          }
        };
      } catch (err) {
        console.error('WebRTC preview failed:', err);
        if (!cancelled) setError(true);
      }
    };

    startWebRTC();

    return () => {
      cancelled = true;
      if (pc) pc.close();
    };
  }, [webrtcBase, retryCount, requiresProcessedPreview]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(false);
        setRetryCount(r => r + 1);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="relative w-full h-full bg-zinc-950 flex items-center justify-center overflow-hidden">
      {!error ? (
        <div className="relative max-w-full max-h-full flex items-center justify-center">
          {requiresProcessedPreview ? (
            <img
              key={`mjpeg-${retryCount}`}
              src={streamUrl}
              className={cn(
                "max-w-full max-h-full object-contain transition-all duration-300",
                settings.peaking && "brightness-110 contrast-125",
                (settings.peaking && settings.peakingMono) && "saturate-0"
              )}
              onError={() => setError(true)}
              alt="Camera Feed"
            />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="max-w-full max-h-full object-contain transition-all duration-300"
            />
          )}

          {settings.grid && (
            <svg className="absolute inset-0 w-full h-full stroke-white/40 stroke-[1px] pointer-events-none">
              <line x1="33.33%" y1="0" x2="33.33%" y2="100%" />
              <line x1="66.66%" y1="0" x2="66.66%" y2="100%" />
              <line x1="0" y1="33.33%" x2="100%" y2="33.33%" />
              <line x1="0" y1="66.66%" x2="100%" y2="66.66%" />
            </svg>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Camera className="w-16 h-16 text-zinc-800 animate-pulse" strokeWidth={1} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">
            {isWails ? "Hardware Offline" : "Connecting to Stream..."}
          </span>
          {!isWails && <div className="text-[8px] text-zinc-800 font-mono">Attempt {retryCount + 1}</div>}
        </div>
      )}

      {isRecording && (
        <div className="absolute inset-0 border-[6px] border-red-600/40 pointer-events-none animate-pulse z-20" />
      )}

      {settings.falseColor && (
        <div className={cn(
          "absolute top-20 flex flex-col gap-0.5 z-30 opacity-80",
          orientation === 'landscape' ? "left-24" : "right-20"
        )}>
          {[
            { c: '#ff0000', l: '100 - CLIP' },
            { c: '#ffff00', l: '90 - OVER' },
            { c: '#00ff00', l: '55 - SKIN' },
            { c: '#ff00ff', l: '40 - GRAY' },
            { c: '#0000ff', l: '10 - DARK' },
            { c: '#4b0082', l: '0 - BLACK' }
          ].map(item => (
            <div key={item.l} className="flex items-center gap-2 bg-black/40 px-2 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-tighter whitespace-nowrap border border-white/5 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full shadow-[0_0_4px_rgba(255,255,255,0.5)]" style={{ backgroundColor: item.c }} />
              {item.l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const MediaGallery = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileToDelete, setFileToDelete] = useState(null);

  const refreshFiles = useCallback(() => {
    callBackend('ListCaptures')
      .then(res => {
        setFiles(res || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const confirmDelete = () => {
    if (!fileToDelete) return;
    callBackend('DeleteCapture', fileToDelete.name).then(() => {
      if (selectedFile?.name === fileToDelete.name) setSelectedFile(null);
      setFileToDelete(null);
      refreshFiles();
    });
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) return <div className="flex items-center justify-center h-full text-zinc-500 font-bold uppercase tracking-widest animate-pulse">Loading Clips...</div>;

  if (files.length === 0) return <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-600"><Play className="w-12 h-12 opacity-20" /><span className="font-bold uppercase tracking-widest">No Clips Recorded</span></div>;

  return (
    <div className="relative h-full">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
        {files.map(file => (
          <div 
            key={file.name} 
            onClick={() => setSelectedFile(file)}
            className="glass rounded-2xl p-4 flex flex-col gap-3 group border border-white/5 cursor-pointer hover:border-accent-blue/30 transition-all"
          >
            <div className="aspect-video bg-zinc-900 rounded-xl flex items-center justify-center relative overflow-hidden">
               {file.thumbnail ? (
                 <img 
                   src={file.thumbnail} 
                   alt={file.name}
                   className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                 />
               ) : (
                 <Play className="w-8 h-8 text-zinc-800 group-hover:text-accent-blue transition-colors" />
               )}
               <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
               <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 rounded text-[10px] font-bold text-white uppercase tracking-tighter">{file.extension || 'MP4'}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-bold text-white truncate">{file.name}</span>
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{file.date} • {formatSize(file.size)}</span>
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); setFileToDelete(file); }} 
                className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {fileToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-3xl max-w-sm w-full shadow-2xl"
            >
              <h3 className="text-lg font-bold text-white uppercase mb-2">Delete Clip?</h3>
              <p className="text-sm text-zinc-400 mb-8">This action cannot be undone. Are you sure you want to delete <span className="text-white font-mono text-xs">{fileToDelete.name}</span>?</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setFileToDelete(null)}
                  className="flex-1 py-3 bg-zinc-800 text-white font-bold uppercase text-xs rounded-xl hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-3 bg-red-600 text-white font-bold uppercase text-xs rounded-xl hover:bg-red-500 transition-all shadow-lg shadow-red-600/20"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex flex-col p-4 md:p-12"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-col">
                <h3 className="text-xl font-bold text-white uppercase tracking-tight">{selectedFile.name}</h3>
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">{selectedFile.date} • {formatSize(selectedFile.size)}</span>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                className="p-4 bg-zinc-900 rounded-full text-white hover:bg-zinc-800 transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center relative group">
              <video 
                src={`/captures/${selectedFile.name}`} 
                controls 
                autoPlay
                className="max-w-full max-h-full rounded-2xl shadow-2xl shadow-black/50 border border-white/5"
              />
            </div>
            
            <div className="h-24 flex items-center justify-center gap-8">
               <button 
                 onClick={() => setFileToDelete(selectedFile)}
                 className="px-8 py-3 bg-red-600/10 border border-red-600/20 text-red-500 rounded-full font-bold uppercase text-xs hover:bg-red-600/20 transition-all"
               >
                 Delete Clip
               </button>
               <a 
                 href={`/captures/${selectedFile.name}`} 
                 download 
                 className="px-8 py-3 bg-accent-blue text-white rounded-full font-bold uppercase text-xs hover:bg-accent-blue/80 transition-all"
               >
                 Download Original
               </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TelemetryItem = memo(({ label, value, active = false, onClick }) => {
  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onClick({ left: rect.left, bottom: rect.bottom, width: rect.width });
  };

  return (
    <button onClick={handleClick} className={cn("flex flex-col items-start px-3 py-1 rounded-md transition-all min-w-[60px]", active ? "bg-accent-blue/10 border border-accent-blue/30" : "hover:bg-zinc-800/50 border border-transparent")}>
      <span className="telemetry-label">{label}</span>
      <span className={cn("telemetry-value text-base md:text-xl", active && "text-accent-blue")}>{value}</span>
    </button>
  );
});

const WifiIndicator = memo(({ wifiStatus }) => {
  const connected = !!wifiStatus?.connected;
  const supported = !!wifiStatus?.supported;
  const tone = connected ? "text-emerald-400" : supported ? "text-zinc-500" : "text-amber-400";

  return (
    <div className={cn("flex items-center", tone)} title={connected ? `Wi-Fi connected: ${wifiStatus?.ssid || 'Unknown'}` : "Wi-Fi not connected"}>
      <Wifi className="w-4 h-4" />
    </div>
  );
});

const CpuTempIndicator = memo(({ cpuTemp }) => {
  const temp = Number.isFinite(cpuTemp) ? cpuTemp : 0;
  const tone = temp >= 75 ? "text-red-400" : temp >= 65 ? "text-amber-400" : "text-zinc-300";

  return (
    <div className={cn("flex items-center gap-1.5", tone)} title={`CPU Temp: ${temp.toFixed(1)}C`}>
      <Thermometer className="w-4 h-4" />
      <span className="text-[10px] font-black uppercase tracking-widest">{temp.toFixed(1)}C</span>
    </div>
  );
});

const SettingsOption = memo(({ label, value, active, onClick, icon: Icon }) => (
  <button onClick={onClick} className={cn("flex items-center justify-between p-4 rounded-xl transition-all border w-full text-left", active ? "bg-accent-blue/10 border-accent-blue/30 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700")}>
    <div className="flex items-center gap-3">
      {Icon && <Icon className={cn("w-5 h-5", active ? "text-accent-blue" : "text-zinc-500")} />}
      <span className="text-sm font-medium">{label}</span>
    </div>
    <span className={cn("text-sm font-bold", active ? "text-accent-blue" : "text-zinc-500")}>{value}</span>
  </button>
));

const Toggle = ({ active, onClick }) => (
  <button onClick={onClick} className={cn("w-12 h-6 rounded-full relative p-1 transition-colors", active ? "bg-accent-blue" : "bg-zinc-800")}>
    <motion.div animate={{ x: active ? 24 : 0 }} className="w-4 h-4 bg-white rounded-full shadow-sm" />
  </button>
);

const QuickPicker = ({ activeQuickSetting, settings, setSettings, setActiveQuickSetting, position, dynamicOptions = {} }) => {
  if (!activeQuickSetting) return null;
  const options = dynamicOptions[activeQuickSetting.id] || (activeQuickSetting.id === 'fps' ? getFpsOptions(settings.resolution) : OPTIONS[activeQuickSetting.id]);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setActiveQuickSetting(null)} className="absolute inset-0 z-[60] bg-black/20 backdrop-blur-[2px]" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -10 }}
        style={{ left: position?.left || '50%', top: position?.bottom ? position.bottom + 8 : '20%', transform: position ? 'none' : 'translateX(-50%)' }}
        className={cn("absolute z-[70] p-1 glass rounded-2xl flex flex-col overflow-hidden shadow-2xl min-w-[120px] max-h-[60vh]", !position && "left-1/2 -translate-x-1/2")}
      >
        <div className="flex-1 flex flex-col gap-1 px-1 py-1 overflow-y-auto no-scrollbar">
          {activeQuickSetting.id === 'kelvin' && (
            <button onClick={() => setActiveQuickSetting({ id: 'wb', position })} className="px-4 h-10 rounded-xl text-xs font-black uppercase transition-all shrink-0 text-left flex items-center gap-2 text-accent-blue hover:bg-accent-blue/10 mb-1 border-b border-white/5">← Back to Presets</button>
          )}
          {options?.map((item) => {
            const val = typeof item === 'object' && item !== null && Object.prototype.hasOwnProperty.call(item, 'value') ? item.value : item;
            const label = typeof item === 'object' && item !== null && Object.prototype.hasOwnProperty.call(item, 'label') ? item.label : val;
            return (
            <button
              key={val}
              onClick={() => {
                if (activeQuickSetting.id === 'wb' && val === 'Manual') {
                  setSettings({ ...settings, wb: 'Manual' });
                  setActiveQuickSetting({ id: 'kelvin', position });
                } else {
                  setSettings({ ...settings, [activeQuickSetting.id]: val });
                  setActiveQuickSetting(null);
                }
              }}
              className={cn("px-4 h-10 rounded-xl text-sm font-bold transition-all shrink-0 text-left flex items-center justify-between", settings[activeQuickSetting.id] === val ? "bg-accent-blue text-white shadow-lg shadow-accent-blue/30" : "text-zinc-400 hover:text-white hover:bg-zinc-800")}
            >
              <span>{typeof val === 'number' && activeQuickSetting.id === 'bitrate' ? `${val}M` : typeof val === 'number' && activeQuickSetting.id === 'kelvin' ? `${val}K` : typeof val === 'number' && activeQuickSetting.id === 'audioGain' ? `${val}%` : label}</span>
              {settings[activeQuickSetting.id] === val && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </button>
            );
          })}
        </div>
      </motion.div>
    </>
  );
};

const SettingsOverlay = ({ 
  orientation, activeTab, setActiveTab, setShowSettings, settings, setSettings, setActiveQuickSetting, systemStats, audioLevels,
  wifiStatus, wifiNetworks, wifiSSID, setWifiSSID, wifiPassword, setWifiPassword, wifiLoading, wifiMessage, onWifiScan, onWifiConnect, onHotspotStart, onHotspotStop,
  streamStatus, onStreamStart, onStreamStop, streamLoading
}) => {
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);
  const diskTotalGB = (systemStats.diskTotal / (1024 ** 3)).toFixed(1);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [showHotspotPassword, setShowHotspotPassword] = useState(false);
  const [streamProtocol, setStreamProtocol] = useState('webrtc');

  return (
    <motion.div initial={{ opacity: 0, y: orientation === 'landscape' ? 0 : 100, scale: orientation === 'landscape' ? 1.05 : 1 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: orientation === 'landscape' ? 0 : 100, scale: orientation === 'landscape' ? 1.05 : 1 }} transition={{ type: "spring", damping: 25, stiffness: 200 }} className="absolute inset-0 z-50 bg-zinc-950 flex flex-col md:rounded-t-3xl overflow-hidden border-t border-zinc-800">
      <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-900 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-4"><h2 className="text-lg font-bold tracking-tight text-white uppercase">{activeTab === 'media' ? 'Media Gallery' : 'Camera Settings'}</h2><div className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">v2.0 Pi4 HQ</div></div>
        <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-zinc-900 rounded-full transition-colors"><X className="w-6 h-6" /></button>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-20 md:w-48 border-r border-zinc-900 flex flex-col gap-2 p-2 shrink-0">
          {[{ id: 'camera', icon: Camera, label: 'Camera' }, { id: 'media', icon: Play, label: 'Media' }, { id: 'recording', icon: Circle, label: 'Record' }, { id: 'audio', icon: Mic2, label: 'Audio' }, { id: 'monitoring', icon: Eye, label: 'Monitor' }, { id: 'network', icon: Wifi, label: 'Network' }, { id: 'system', icon: Cpu, label: 'System' }].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn("flex flex-col md:flex-row items-center gap-3 p-3 md:px-4 rounded-xl transition-all", activeTab === tab.id ? "bg-accent-blue text-white shadow-lg shadow-accent-blue/20" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900")}>
              <tab.icon className="w-6 h-6 shrink-0" /><span className="hidden md:block text-sm font-bold uppercase tracking-wider">{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden bg-zinc-950 relative"><div className="absolute inset-0 overflow-y-auto p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="h-full">
              {activeTab === 'camera' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="telemetry-label mb-2 text-accent-blue">Exposure Control</h3>
                    <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between"><span className="text-sm font-medium">180° Shutter Rule</span><Toggle active={settings.shutterMode === '180'} onClick={() => updateSetting('shutterMode', settings.shutterMode === '180' ? 'manual' : '180')} /></div>
                    <SettingsOption label="ISO (Analog Gain)" value={settings.iso} onClick={() => setActiveQuickSetting({ id: 'iso' })} active />
                    <SettingsOption label="Shutter Speed" value={settings.shutterMode === '180' ? 'AUTO (180°)' : settings.shutter} onClick={() => settings.shutterMode !== '180' && setActiveQuickSetting({ id: 'shutter' })} />
                    <SettingsOption label="WB Preset" value={settings.wb} onClick={() => setActiveQuickSetting({ id: 'wb' })} active />
                    {settings.wb === 'Manual' && <SettingsOption label="Kelvin" value={`${settings.kelvin}K`} onClick={() => setActiveQuickSetting({ id: 'kelvin' })} active />}
                    <SettingsOption label="Tint" value={settings.tint} onClick={() => setActiveQuickSetting({ id: 'tint' })} />
                  </div>
                  <div className="space-y-4">
                    <h3 className="telemetry-label mb-2 text-accent-blue">Sensor Mode</h3>
                    <SettingsOption label="Preview Resolution" value={settings.resolution} onClick={() => setActiveQuickSetting({ id: 'resolution' })} active />
                    <SettingsOption label="Frame Rate" value={`${settings.fps} fps`} onClick={() => setActiveQuickSetting({ id: 'fps' })} active />
                    <SettingsOption label="Flicker Reduction" value={settings.flicker} onClick={() => setActiveQuickSetting({ id: 'flicker' })} />
                    <SettingsOption label="Anamorphic" value={settings.anamorphic} onClick={() => setActiveQuickSetting({ id: 'anamorphic' })} />
                  </div>
                </div>
              )}
              {activeTab === 'media' && <MediaGallery />}
              {activeTab === 'audio' && (
                <div className="space-y-8 max-w-2xl">
                  <h3 className="telemetry-label mb-2 text-accent-blue">Audio Configuration</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between"><span className="text-sm font-medium text-white">Record Audio (USB)</span><Toggle active={!!settings.audioEnabled} onClick={() => updateSetting('audioEnabled', !settings.audioEnabled)} /></div>
                    <SettingsOption label="Input Gain" value={`${settings.audioGain}%`} onClick={() => setActiveQuickSetting({ id: 'audioGain' })} active />
                    <SettingsOption label="Audio Format" value={settings.audioFormat || 'AAC'} onClick={() => setActiveQuickSetting({ id: 'audioFormat' })} active />
                    <SettingsOption label="Input Source" value="USB Audio Device" />
                    <SettingsOption label="USB Device" value={settings.audioDevice || 'plughw:1,0'} onClick={() => setActiveQuickSetting({ id: 'audioDevice' })} active />
                    <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between"><span className="text-sm font-medium text-white">Phantom Power (+48V)</span><Toggle active={false} onClick={() => {}} /></div>
                    <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between"><span className="text-sm font-medium text-white">Low Cut Filter</span><Toggle active={true} onClick={() => {}} /></div>
                  </div>
                  <div className="mt-8 p-6 rounded-2xl bg-zinc-900 border border-zinc-800"><div className="flex items-center gap-4 mb-6"><Mic2 className="w-6 h-6 text-accent-blue" /><div><h4 className="font-bold uppercase tracking-tight">Level Monitor</h4><p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">L/R Peak Meter</p></div></div><VUMeter levels={audioLevels} /></div>
                </div>
              )}
              {activeTab === 'recording' && (
                <div className="space-y-4 max-w-2xl">
                  <h3 className="telemetry-label mb-2 text-accent-blue">Recording Pipeline</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <SettingsOption label="Codec" value={settings.codec} onClick={() => setActiveQuickSetting({ id: 'codec' })} active />
                    <SettingsOption label="Bitrate" value={`${settings.bitrate} Mbps`} onClick={() => setActiveQuickSetting({ id: 'bitrate' })} active />
                    <SettingsOption label="Record Resolution" value={settings.recordResolution} onClick={() => setActiveQuickSetting({ id: 'recordResolution' })} active />
                    <SettingsOption label="File Container" value={settings.container} onClick={() => setActiveQuickSetting({ id: 'container' })} active />
                    <SettingsOption label="Format" value="H.264 High" />
                  </div>
                  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-white">Record-Run Timecode</div>
                      <div className="text-xs text-zinc-500 mt-1">Reset to 00:00:00:00 for new slate/day</div>
                    </div>
                    <button
                      onClick={() => {
                        updateSetting('timecodeFrames', 0);
                        toast.success('Record-run timecode reset to 00:00:00:00.');
                      }}
                      className="px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-wider"
                    >
                      Reset TC
                    </button>
                  </div>
                  <div className="mt-8 p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center gap-4"><div className="p-3 bg-accent-blue/10 rounded-xl shrink-0"><HardDrive className="w-6 h-6 text-accent-blue" /></div><div className="flex-1 min-w-0"><h4 className="font-bold uppercase tracking-tight truncate">Storage Mount</h4><div className="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-accent-blue" style={{ width: `${(systemStats.diskTotal - systemStats.diskFree) / systemStats.diskTotal * 100}%` }} /></div><p className="text-[10px] text-zinc-500 mt-2 uppercase font-bold tracking-widest truncate">{diskFreeGB}GB Free of {diskTotalGB}GB</p></div></div>
                </div>
              )}
              {activeTab === 'monitoring' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="telemetry-label text-accent-blue">HUD Overlays</h3>
                      {[
                        { id: 'peaking', label: 'Focus Peaking', icon: Focus },
                        { id: 'peakingMono', label: 'Peaking Mono (B&W)', icon: Eye },
                        { id: 'zebras', label: 'Exposure Zebras', icon: Activity },
                        { id: 'falseColor', label: 'False Color', icon: Box },
                        { id: 'histogram', label: 'Real-time Histogram', icon: SlidersHorizontal },
                        { id: 'grid', label: 'Grid Guides', icon: Grid3X3 }
                      ].map(tool => (
                        <div key={tool.id} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between"><div className="flex items-center gap-3 text-zinc-300"><tool.icon className="w-5 h-5" /><span className="text-sm font-medium">{tool.label}</span></div><Toggle active={settings[tool.id]} onClick={() => updateSetting(tool.id, !settings[tool.id])} /></div>
                      ))}
                    </div>
                    <div className="space-y-4">
                      <h3 className="telemetry-label text-accent-blue">Monitor Logic</h3>
                      <SettingsOption label="3D LUT" value={settings.lut} active />
                      <SettingsOption label="Grid Guides" value="Rule of Thirds" />
                    </div>
                </div>
              )}
              {activeTab === 'network' && (
                <div className="space-y-6 max-w-3xl">
                  <h3 className="telemetry-label mb-2 text-accent-blue">Network</h3>
                  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm space-y-2">
                    <div className="font-semibold text-white">Current Status</div>
                    {wifiStatus?.supported ? (
                      <div className={cn("text-zinc-300", wifiStatus.connected && "text-emerald-300")}>
                        {wifiStatus.connected ? `Connected to ${wifiStatus.ssid}${wifiStatus.ip ? ` (${wifiStatus.ip})` : ''}` : 'Not connected'}
                      </div>
                    ) : (
                      <div className="text-amber-400">Wi-Fi control unavailable (nmcli not found).</div>
                    )}
                    {wifiStatus?.mode && (
                      <div className="text-xs uppercase font-bold tracking-widest text-zinc-500">
                        Mode: <span className="text-zinc-300">{wifiStatus.mode}</span>
                      </div>
                    )}
                    <div className="text-xs uppercase font-bold tracking-widest text-zinc-500 pt-1">
                      Selected network: <span className="text-zinc-300 normal-case tracking-normal font-semibold">{wifiSSID || 'None'}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">Hotspot Fallback</div>
                        <div className="text-xs text-zinc-500 mt-1">Auto-start AP when disconnected after boot timeout</div>
                      </div>
                      <Toggle active={!!settings.autoHotspot} onClick={() => updateSetting('autoHotspot', !settings.autoHotspot)} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-xs uppercase font-bold tracking-widest text-zinc-500">Hotspot SSID</label>
                        <input value={settings.hotspotSSID || ''} onChange={(e) => updateSetting('hotspotSSID', e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white" placeholder="PiCam-XXXX" />
                      </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase font-bold tracking-widest text-zinc-500">Hotspot Password</label>
                        <div className="relative">
                          <input type={showHotspotPassword ? 'text' : 'password'} value={settings.hotspotPassword || ''} onChange={(e) => updateSetting('hotspotPassword', e.target.value)} className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 pr-11 text-white" placeholder="Minimum 8 characters" />
                          <button type="button" onClick={() => setShowHotspotPassword((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-zinc-200" aria-label={showHotspotPassword ? 'Hide hotspot password' : 'Show hotspot password'}>
                            {showHotspotPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                    </div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={onHotspotStart} className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold" disabled={wifiLoading || !settings.hotspotSSID || (settings.hotspotPassword || '').length < 8}>Start Hotspot</button>
                      <button onClick={onHotspotStop} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold" disabled={wifiLoading}>Stop Hotspot</button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button onClick={onWifiScan} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold" disabled={wifiLoading}>
                      {wifiLoading ? 'Scanning...' : 'Scan Networks'}
                    </button>
                    <span className="text-xs text-zinc-500 uppercase font-bold tracking-widest">{wifiNetworks.length} found</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {wifiNetworks.map((net) => (
                      <button
                        key={net.ssid}
                        onClick={() => setWifiSSID(net.ssid)}
                        className={cn(
                          "text-left p-3 rounded-lg border transition-colors",
                          wifiSSID === net.ssid ? "border-accent-blue bg-accent-blue/10" : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                        )}
                      >
                        <div className="text-white font-semibold truncate">{net.ssid}</div>
                        <div className="text-xs text-zinc-400 mt-1">Signal {net.signal}% · {net.security || 'Open'}{net.inUse ? ' · Active' : ''}</div>
                      </button>
                    ))}
                    {wifiNetworks.length === 0 && (
                      <div className="md:col-span-2 p-4 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 text-sm text-zinc-400">
                        No scan results yet. Run a scan to discover nearby networks.
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs uppercase font-bold tracking-widest text-zinc-500">SSID</label>
                      <input value={wifiSSID} onChange={(e) => setWifiSSID(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white" placeholder="Network name" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase font-bold tracking-widest text-zinc-500">Password</label>
                      <div className="relative">
                        <input type={showWifiPassword ? 'text' : 'password'} value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 pr-11 text-white" placeholder="Password" />
                        <button type="button" onClick={() => setShowWifiPassword((v) => !v)} className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-zinc-200" aria-label={showWifiPassword ? 'Hide Wi-Fi password' : 'Show Wi-Fi password'}>
                          {showWifiPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button onClick={onWifiConnect} className="px-4 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/90 text-white text-sm font-bold" disabled={wifiLoading || !wifiSSID}>
                    {wifiLoading ? 'Connecting...' : 'Connect'}
                  </button>

                  {wifiMessage && <div className="text-sm text-zinc-300">{wifiMessage}</div>}
                </div>
              )}
              {activeTab === 'streaming' && (
                <div className="space-y-6 max-w-3xl">
                  <h3 className="telemetry-label mb-2 text-accent-blue">Streaming (MediaMTX)</h3>
                  <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">Publisher Profile</div>
                        <div className="text-xs text-zinc-500 mt-1">Clean 1080p stream. Server starts only when you press Start Stream.</div>
                      </div>
                      <div className={cn("px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest", streamStatus?.active ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-zinc-800 text-zinc-400 border border-zinc-700")}>{streamStatus?.active ? 'LIVE' : 'IDLE'}</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs uppercase font-bold tracking-widest text-zinc-500">Server <span className={cn("ml-2", streamStatus?.server ? 'text-emerald-300' : 'text-zinc-300')}>{streamStatus?.server ? 'Running' : 'Stopped'}</span></div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs uppercase font-bold tracking-widest text-zinc-500">Publisher <span className={cn("ml-2", streamStatus?.active ? 'text-emerald-300' : 'text-zinc-300')}>{streamStatus?.active ? 'Live' : 'Stopped'}</span></div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-xs uppercase font-bold tracking-widest text-zinc-500">Audio <span className={cn("ml-2", streamStatus?.audioLive ? 'text-emerald-300' : 'text-amber-300')}>{streamStatus?.audioLive ? 'Live' : 'Video Only'}</span></div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-zinc-300">Include USB audio in stream</div>
                      <Toggle active={!!settings.streamAudio} onClick={() => updateSetting('streamAudio', !settings.streamAudio)} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs uppercase font-bold tracking-widest text-zinc-500">Delivery Mode</div>
                      <div className="flex gap-2">
                        <button onClick={() => setStreamProtocol('webrtc')} className={cn("px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border", streamProtocol === 'webrtc' ? "bg-emerald-700/30 border-emerald-500/40 text-emerald-200" : "bg-zinc-900 border-zinc-700 text-zinc-400")}>WebRTC (Low Latency)</button>
                        <button onClick={() => setStreamProtocol('rtsp')} className={cn("px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border", streamProtocol === 'rtsp' ? "bg-accent-blue/30 border-accent-blue/40 text-blue-100" : "bg-zinc-900 border-zinc-700 text-zinc-400")}>RTSP (VLC/OBS)</button>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 break-all">
                        {streamProtocol === 'webrtc' ? (streamStatus?.webrtcUrl || 'http://<pi-ip>:8889/picam') : (streamStatus?.rtspUrl || 'rtsp://<pi-ip>:8554/picam')}
                      </div>
                    <div className="text-xs text-zinc-500">Use WebRTC on mobile for lowest latency. Use RTSP for VLC/OBS ingest.</div>
                    {!!settings.streamAudio && !streamStatus?.audioLive && streamStatus?.active && (
                      <div className="text-xs text-amber-300">Audio input fallback active. Stream is currently video-only.</div>
                    )}
                    </div>
                    <div className="flex gap-3">
                      <button onClick={onStreamStart} className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold" disabled={streamLoading}>{streamLoading ? 'Working...' : 'Start Stream'}</button>
                      <button onClick={onStreamStop} className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-bold" disabled={streamLoading}>Stop Stream</button>
                    </div>
                  </div>
                </div>
              )}
              {activeTab === 'system' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800"><div className="flex items-center gap-2 text-orange-500 mb-2"><Thermometer className="w-4 h-4" /><span className="text-[10px] font-bold uppercase tracking-widest">CPU Temp</span></div><span className="text-2xl font-mono">{systemStats.cpuTemp.toFixed(1)}°C</span></div>
                     <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800"><div className="flex items-center gap-2 text-green-500 mb-2"><Zap className="w-4 h-4" /><span className="text-[10px] font-bold uppercase tracking-widest">Voltage</span></div><span className="text-2xl font-mono">{systemStats.voltage.toFixed(2)}V</span></div>
                     <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800"><div className="flex items-center gap-2 text-accent-blue mb-2"><Cpu className="w-4 h-4" /><span className="text-[10px] font-bold uppercase tracking-widest">Memory</span></div><span className="text-2xl font-mono">{systemStats.memoryFree.toFixed(1)}GB</span></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><button className="p-4 bg-red-600/10 border border-red-600/20 text-red-500 rounded-xl font-bold uppercase text-xs hover:bg-red-600/20 transition-all">Shut Down System</button><button className="p-4 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-xl font-bold uppercase text-xs hover:bg-zinc-700 transition-all">Reboot Camera</button></div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div></div>
      </div>
    </motion.div>
  );
};

const LandscapeLayout = memo(({ 
  settings, setSettings, activeQuickSetting, setActiveQuickSetting, isRecording, toggleRecording, timecode, setActiveTab, setShowSettings, systemStats, audioLevels, compact, wifiStatus
}) => {
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const isMonitorMode = false;

  return (
    <div className="relative w-full h-screen flex flex-col overflow-hidden">
      <div className={cn("absolute top-0 inset-x-0 glass flex items-center justify-between z-20", compact ? "h-12 px-3" : "h-16 px-6")}>
        <div className="flex gap-4">
          <TelemetryItem label="FPS" value={settings.fps} active={!isMonitorMode && activeQuickSetting?.id === 'fps'} onClick={(pos) => !isMonitorMode && setActiveQuickSetting(activeQuickSetting?.id === 'fps' ? null : { id: 'fps', position: pos })} />
          <TelemetryItem label="Shutter" value={settings.shutterMode === '180' ? 'AUTO (180°)' : settings.shutter} active={!isMonitorMode && activeQuickSetting?.id === 'shutter'} onClick={(pos) => !isMonitorMode && settings.shutterMode !== '180' && setActiveQuickSetting(activeQuickSetting?.id === 'shutter' ? null : { id: 'shutter', position: pos })} />
        </div>
        <div className="flex flex-col items-center">
          <span className={cn(compact ? "text-xl" : "text-2xl", "font-mono tracking-widest font-bold", isRecording ? "text-red-500" : "text-white")}>{timecode}</span>
          <div className="flex items-center gap-2 mt-[-4px]"><div className={cn("w-2 h-2 rounded-full", isRecording ? "bg-red-600 animate-pulse" : "bg-zinc-700")} /><span className="text-[10px] uppercase font-black tracking-widest text-zinc-300">{isRecording ? "Recording" : "Standby"}</span></div>
        </div>
        <div className="flex gap-4">
          <TelemetryItem label="ISO" value={settings.iso} active={!isMonitorMode && activeQuickSetting?.id === 'iso'} onClick={(pos) => !isMonitorMode && setActiveQuickSetting(activeQuickSetting?.id === 'iso' ? null : { id: 'iso', position: pos })} />
          <TelemetryItem label="WB" value={settings.wb === 'Manual' ? `${settings.kelvin}K` : settings.wb} active={!isMonitorMode && (activeQuickSetting?.id === 'wb' || activeQuickSetting?.id === 'kelvin')} onClick={(pos) => { if (!isMonitorMode) { if (settings.wb === 'Manual') { setActiveQuickSetting(activeQuickSetting?.id === 'kelvin' ? { id: 'wb', position: pos } : { id: 'kelvin', position: pos }); } else { setActiveQuickSetting(activeQuickSetting?.id === 'wb' ? null : { id: 'wb', position: pos }); } } }} />
          <TelemetryItem label="Tint" value={settings.tint} active={!isMonitorMode && activeQuickSetting?.id === 'tint'} onClick={(pos) => !isMonitorMode && setActiveQuickSetting(activeQuickSetting?.id === 'tint' ? null : { id: 'tint', position: pos })} />
        </div>
      </div>
      <div className="flex-1 relative bg-zinc-900 overflow-hidden flex items-center justify-center">
        <LivePreview isRecording={isRecording} settings={settings} orientation="landscape" />
        {!isMonitorMode && <div className={cn("absolute w-12 flex flex-col", compact ? "left-3 top-16 bottom-16 gap-2" : "left-6 top-1/2 -translate-y-1/2 gap-4")}>
          <button onClick={() => updateSetting('peaking', !settings.peaking)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.peaking ? "text-accent-blue border-accent-blue/40" : "text-white/60")}><Focus className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('zebras', !settings.zebras)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.zebras ? "text-accent-blue border-accent-blue/40" : "text-white/60")}><Activity className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('falseColor', !settings.falseColor)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.falseColor ? "text-accent-blue border-accent-blue/40" : "text-white/60")}><Box className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('histogram', !settings.histogram)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.histogram ? "text-accent-blue border-accent-blue/40" : "text-white/60")}><SlidersHorizontal className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('grid', !settings.grid)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.grid ? "text-accent-blue border-accent-blue/40" : "text-white/60")}><Grid3X3 className="w-6 h-6" /></button>
        </div>}
        {settings.histogram && <div className="absolute left-24 bottom-24 z-10"><Histogram data={systemStats.histogram} /></div>}
        <div className={cn("absolute flex flex-col", compact ? "right-3 top-16 bottom-16 gap-3 justify-center" : "right-6 top-1/2 -translate-y-1/2 gap-8")}>
           <button onClick={toggleRecording} className="group relative flex items-center justify-center"><div className={cn("absolute border-2 border-white/20 rounded-full group-active:scale-90 transition-transform", compact ? "w-16 h-16" : "w-20 h-20")} /><div className={cn(compact ? "w-12 h-12" : "w-16 h-16", "rounded-full transition-all flex items-center justify-center shadow-lg shadow-red-900/20", isRecording ? "bg-red-600 rounded-xl scale-90" : "bg-red-600 scale-100")}>{!isRecording && <Circle className={cn("fill-white text-white", compact ? "w-4 h-4" : "w-6 h-6")} />}</div></button>
            <button onClick={() => { setActiveTab('camera'); setShowSettings(true); }} className={cn(compact ? "p-2" : "p-4", "glass rounded-full btn-tactile flex items-center justify-center")}><Settings className={cn(compact ? "w-5 h-5" : "w-7 h-7", "text-white/80")} /></button>
        </div>
        {!compact && <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-96 h-12 glass rounded-lg flex items-center px-4 gap-4"><Mic2 className="w-4 h-4 text-zinc-500" /><VUMeter levels={audioLevels} /><span className="text-[10px] font-mono text-zinc-400 whitespace-nowrap">-12dB</span></div>}
        {!compact && <div className="absolute bottom-6 right-8 flex items-center gap-4"><WifiIndicator wifiStatus={wifiStatus} /><CpuTempIndicator cpuTemp={systemStats.cpuTemp} /><div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{diskFreeGB}GB FREE</div></div>}
      </div>
    </div>
  );
});

const PortraitLayout = memo(({ 
  settings, setSettings, activeQuickSetting, setActiveQuickSetting, isRecording, toggleRecording, timecode, setActiveTab, setShowSettings, systemStats, audioLevels, wifiStatus
}) => {
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const isMonitorMode = false;

  return (
    <div className="relative w-full h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <div className="px-3 pt-4 pb-2 flex justify-between items-center bg-zinc-950 shrink-0">
        <CpuTempIndicator cpuTemp={systemStats.cpuTemp} />
        <div className="flex flex-col items-center"><span className={cn("text-xl font-mono font-bold tracking-wider leading-none", isRecording ? "text-red-500" : "text-white")}>{timecode}</span><div className="flex items-center gap-1 mt-1"><div className={cn("w-1.5 h-1.5 rounded-full", isRecording ? "bg-red-600 animate-pulse" : "bg-zinc-700")} /><span className="text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">PREVIEW</span></div></div>
        <WifiIndicator wifiStatus={wifiStatus} />
      </div>
      <div className="w-full aspect-video bg-zinc-900 relative overflow-hidden flex items-center justify-center shrink-0 mb-2">
         <LivePreview isRecording={isRecording} settings={settings} orientation="portrait" />
        {settings.histogram && <div className="absolute bottom-4 left-4 z-10 scale-75 origin-bottom-left"><Histogram data={systemStats.histogram} /></div>}
        {!isMonitorMode && <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col gap-2">
           <button onClick={() => updateSetting('peaking', !settings.peaking)} className={cn("p-2 glass rounded-lg transition-colors", settings.peaking ? "text-accent-blue" : "text-white/60")}><Focus className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('zebras', !settings.zebras)} className={cn("p-2 glass rounded-lg transition-colors", settings.zebras ? "text-accent-blue" : "text-white/60")}><Activity className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('falseColor', !settings.falseColor)} className={cn("p-2 glass rounded-lg transition-colors", settings.falseColor ? "text-accent-blue" : "text-white/60")}><Box className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('histogram', !settings.histogram)} className={cn("p-2 glass rounded-lg transition-colors", settings.histogram ? "text-accent-blue" : "text-white/60")}><SlidersHorizontal className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('grid', !settings.grid)} className={cn("p-2 glass rounded-lg transition-colors", settings.grid ? "text-accent-blue" : "text-white/60")}><Grid3X3 className="w-5 h-5" /></button>
        </div>}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-1 h-32 w-4">
           {audioLevels.map((level, i) => (
             <div key={i} className="w-1 bg-zinc-900/60 rounded-full overflow-hidden flex flex-col justify-end p-[0.5px]"><motion.div animate={{ height: `${level * 100}%` }} className={cn("w-full rounded-full", level > 0.9 ? "bg-red-500" : level > 0.7 ? "bg-yellow-500" : "bg-green-500")} /></div>
           ))}
        </div>
      </div>
      <div className="px-3 pt-5 pb-4 gap-2 bg-zinc-950 shrink-0 mt-2">
        <div className="grid grid-cols-4 gap-1.5 mb-3">
            <TelemetryItem label="FPS" value={settings.fps} active={!isMonitorMode && activeQuickSetting?.id === 'fps'} onClick={(pos) => !isMonitorMode && setActiveQuickSetting(activeQuickSetting?.id === 'fps' ? null : { id: 'fps', position: pos })} />
            <TelemetryItem label="ISO" value={settings.iso} active={!isMonitorMode && activeQuickSetting?.id === 'iso'} onClick={(pos) => !isMonitorMode && setActiveQuickSetting(activeQuickSetting?.id === 'iso' ? null : { id: 'iso', position: pos })} />
            <TelemetryItem label="WB" value={settings.wb === 'Manual' ? `${settings.kelvin}K` : settings.wb} active={!isMonitorMode && (activeQuickSetting?.id === 'wb' || activeQuickSetting?.id === 'kelvin')} onClick={(pos) => { if (!isMonitorMode) { if (settings.wb === 'Manual') { setActiveQuickSetting(activeQuickSetting?.id === 'kelvin' ? { id: 'wb', position: pos } : { id: 'kelvin', position: pos }); } else { setActiveQuickSetting(activeQuickSetting?.id === 'wb' ? null : { id: 'wb', position: pos }); } } }} />
            <TelemetryItem label="SHUT" value={settings.shutterMode === '180' ? '180°' : settings.shutter} active={!isMonitorMode && activeQuickSetting?.id === 'shutter'} onClick={(pos) => !isMonitorMode && settings.shutterMode !== '180' && setActiveQuickSetting(activeQuickSetting?.id === 'shutter' ? null : { id: 'shutter', position: pos })} />
         </div>
          <div className="grid grid-cols-3 items-center gap-2 px-2 mt-1">
            <div className="w-14 justify-self-start" />
            <button onClick={toggleRecording} className="group relative flex items-center justify-center justify-self-center translate-y-[8px]"><div className="absolute w-24 h-24 border-4 border-zinc-900 rounded-full group-active:scale-95 transition-transform" /><div className={cn("w-16 h-16 rounded-full transition-all flex items-center justify-center shadow-2xl", isRecording ? "bg-red-600 rounded-xl scale-90" : "bg-red-600 scale-100")}>{!isRecording && <Circle className="fill-white text-white w-7 h-7" />}</div></button>
            <button className="p-4 glass rounded-2xl text-zinc-500 hover:text-white justify-self-end" onClick={() => { setActiveTab('camera'); setShowSettings(true); }}><Settings className="w-6 h-6" /></button>
          </div>
      </div>
    </div>
  );
});

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [timecode, setTimecode] = useState("00:00:00:00");
  const [orientation, setOrientation] = useState(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('camera');
  const [activeQuickSetting, setActiveQuickSetting] = useState(null); 
  const [audioLevels, setAudioLevels] = useState([0, 0]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [audioDevices, setAudioDevices] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [fatalError, setFatalError] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [wifiStatus, setWifiStatus] = useState({ supported: false, connected: false, ssid: '', ip: '' });
  const [streamStatus, setStreamStatus] = useState({ enabled: false, active: false, audio: true, path: 'picam', rtspUrl: 'rtsp://<pi-ip>:8554/picam', webrtcUrl: 'http://<pi-ip>:8889/picam' });
  const [streamLoading, setStreamLoading] = useState(false);
  const [wifiNetworks, setWifiNetworks] = useState([]);
  const [wifiSSID, setWifiSSID] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiLoading, setWifiLoading] = useState(false);
  const [wifiMessage, setWifiMessage] = useState('');
  const lastAutoWifiSSIDRef = useRef('');

  const refreshWifiStatus = useCallback(() => {
    return callBackend('GetWifiStatus')
      .then((status) => {
        if (!status) return;
        setWifiStatus(status);
        if (!status.ssid) return;
        setWifiSSID((prev) => {
          const canAutoApply = !prev || prev === lastAutoWifiSSIDRef.current;
          if (!canAutoApply) return prev;
          lastAutoWifiSSIDRef.current = status.ssid;
          return status.ssid;
        });
      })
      .catch(() => {});
  }, []);

  const refreshStreamStatus = useCallback(() => {
    return callBackend('GetStreamingStatus')
      .then((status) => {
        if (!status) return;
        setStreamStatus(status);
      })
      .catch(() => {});
  }, []);

  const [systemStats, setSystemStats] = useState({
    cpuTemp: 0, voltage: 0, diskFree: 0, diskTotal: 1, memoryFree: 0, histogram: []
  });

  const [settings, setSettings] = useState({
    fps: 24, timecodeMode: 'recordRun', timecodeFrames: 0, shutter: '1/48', shutterMode: '180', iso: 800, wb: 'Daylight', tint: '0', resolution: '1080p', recordResolution: '1080p', codec: 'H.264 (HW)', lut: 'Rec.709', denoise: 'Fast', anamorphic: '1.0x', metering: 'Matrix', flicker: 'Off', bitrate: 25, peaking: false, peakingMono: false, zebras: false, falseColor: false, histogram: true, grid: false, kelvin: 5600, audioGain: 50, audioEnabled: false, audioDevice: 'plughw:1,0', audioFormat: 'AAC', container: 'MP4', previewMode: 'control', autoHotspot: true, hotspotSSID: '', hotspotPassword: ''
  });
  const recordRunStartMsRef = useRef(null);
  const recordRunStartFpsRef = useRef(24);
  const previousFpsRef = useRef(24);
  // 1. Fetch initial config from backend
  useEffect(() => {
    callBackend('GetConfig')
      .then(savedSettings => {
        if (savedSettings) {
          previousFpsRef.current = Math.max(1, Number(savedSettings.fps) || 24);
          setSettings(savedSettings);
          console.log("Settings successfully loaded from backend.");
        }
        setIsInitialized(true);
      })
      .catch(err => {
        console.error("Failed to load settings:", err);
        setIsInitialized(true); 
      });
  }, []);

  // 2. Sync settings changes to backend
  useEffect(() => {
    if (!isInitialized) return;
    const timer = setTimeout(() => {
      callBackend('UpdateConfig', settings).catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [settings, isInitialized]);

  // Handle Shutter 180 Calculation
  useEffect(() => {
    if (settings.shutterMode === '180') {
      const shutterVal = Math.round(settings.fps * 2);
      setSettings(prev => ({ ...prev, shutter: `1/${shutterVal}` }));
    }
  }, [settings.fps, settings.shutterMode]);

  useEffect(() => {
    const allowed = getFpsOptions(settings.resolution);
    if (!allowed.includes(settings.fps)) {
      const fallback = Math.max(...allowed);
      setSettings(prev => ({ ...prev, fps: fallback }));
    }
  }, [settings.resolution, settings.fps]);

  useEffect(() => {
    if (!isInitialized) return;
    const prevFps = Math.max(1, Number(previousFpsRef.current) || 24);
    const nextFps = Math.max(1, Number(settings.fps) || 24);

    if (isRecording) {
      previousFpsRef.current = nextFps;
      return;
    }

    if (prevFps !== nextFps && (settings.timecodeFrames || 0) > 0) {
      const adjustedFrames = Math.max(0, Math.round((settings.timecodeFrames * nextFps) / prevFps));
      if (adjustedFrames !== settings.timecodeFrames) {
        setSettings(prev => ({ ...prev, timecodeFrames: adjustedFrames }));
      }
    }

    previousFpsRef.current = nextFps;
  }, [settings.fps, settings.timecodeFrames, isRecording]);

  // Handle Resizing
  useEffect(() => {
    const handleResize = () => {
      setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const compactLandscape = orientation === 'landscape' && viewportHeight < 520 && window.innerWidth < 900;

  // System Polling
  useEffect(() => {
    let failCount = 0;
    const poll = () => {
      callBackend('GetSystemStats')
        .then(data => { if (!data) throw new Error("Empty response"); setSystemStats(data); setIsLoaded(true); })
        .catch(err => { failCount++; if (failCount > 5 && !isLoaded) setFatalError(`Cannot connect: ${err.message}`); if (!isLoaded) setTimeout(poll, 2000); });
    };
    poll();
    const interval = setInterval(poll, 250);
    return () => clearInterval(interval);
  }, [isLoaded]);

  // Audio Polling
  useEffect(() => {
    const pollAudio = () => { callBackend('GetAudioLevels').then(setAudioLevels).catch(console.error); };
    const interval = setInterval(pollAudio, 250);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    callBackend('ListAudioDevices')
      .then((devices) => {
        const list = Array.isArray(devices) ? devices : [];
        setAudioDevices(list);
        if (list.length > 0 && !list.some((d) => d.value === settings.audioDevice)) {
          setSettings((prev) => ({ ...prev, audioDevice: list[0].value }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshWifiStatus();
    refreshStreamStatus();
  }, [refreshWifiStatus, refreshStreamStatus]);

  useEffect(() => {
    if (!(showSettings && activeTab === 'network') || wifiLoading) return;
    refreshWifiStatus();
    return undefined;
  }, [showSettings, activeTab, refreshWifiStatus, wifiLoading]);

  useEffect(() => {
    if (!(showSettings && activeTab === 'streaming')) return;
    refreshStreamStatus();
    const interval = setInterval(refreshStreamStatus, 1500);
    return () => clearInterval(interval);
  }, [showSettings, activeTab, refreshStreamStatus]);

  const scanWifi = useCallback(() => {
    setWifiLoading(true);
    setWifiMessage('');
    const toastId = toast.loading('Scanning Wi-Fi networks...');
    callBackend('ScanWifiNetworks')
      .then((nets) => {
        const list = Array.isArray(nets) ? nets : [];
        if (list.length > 0) {
          setWifiNetworks(list);
          toast.success(`Found ${list.length} network${list.length === 1 ? '' : 's'}.`, { id: toastId });
          return;
        }
        setWifiMessage('Scan returned no networks. Keeping previous results; try scan again.');
        toast('No networks returned. Kept previous results.', { id: toastId, icon: '⚠️' });
      })
      .catch(() => {
        setWifiMessage('Failed to scan networks');
        toast.error('Wi-Fi scan failed.', { id: toastId });
      })
      .finally(() => setWifiLoading(false));
  }, []);

  const connectWifi = useCallback(() => {
    setWifiLoading(true);
    setWifiMessage('Connecting... this may interrupt current session.');
    const toastId = toast.loading(`Connecting to ${wifiSSID || 'network'}...`);
    callBackend('ConnectWifi', { ssid: wifiSSID, password: wifiPassword })
      .then((res) => {
        if (res && res.success) {
          setWifiMessage('Connection command sent. Reconnect using the Pi\'s new IP if network changes.');
          toast.success('Connection command sent.', { id: toastId });
          return refreshWifiStatus();
        }
        setWifiMessage('Failed to connect. Check SSID/password and try again.');
        toast.error('Failed to connect. Check SSID/password.', { id: toastId });
      })
      .catch(() => {
        setWifiMessage('Failed to connect.');
        toast.error('Connection failed.', { id: toastId });
      })
      .finally(() => setWifiLoading(false));
  }, [wifiSSID, wifiPassword, refreshWifiStatus]);

  const startHotspot = useCallback(() => {
    if (!settings.hotspotSSID || (settings.hotspotPassword || '').length < 8) {
      toast.error('Hotspot password must be at least 8 characters.');
      return;
    }
    setWifiLoading(true);
    const toastId = toast.loading(`Starting hotspot ${settings.hotspotSSID}...`);
    callBackend('StartHotspot', { ssid: settings.hotspotSSID, password: settings.hotspotPassword })
      .then((res) => {
        if (res && res.success) {
          toast.success(`Hotspot started: ${settings.hotspotSSID}`, { id: toastId });
          setWifiMessage(`Hotspot active: ${settings.hotspotSSID}`);
          return refreshWifiStatus();
        }
        toast.error('Failed to start hotspot.', { id: toastId });
      })
      .catch(() => toast.error('Failed to start hotspot.', { id: toastId }))
      .finally(() => setWifiLoading(false));
  }, [settings.hotspotSSID, settings.hotspotPassword, refreshWifiStatus]);

  const stopHotspot = useCallback(() => {
    setWifiLoading(true);
    const toastId = toast.loading('Stopping hotspot...');
    callBackend('StopHotspot')
      .then((res) => {
        if (res && res.success) {
          toast.success('Hotspot stopped.', { id: toastId });
          setWifiMessage('Hotspot stopped.');
          return refreshWifiStatus();
        }
        toast.error('Failed to stop hotspot.', { id: toastId });
      })
      .catch(() => toast.error('Failed to stop hotspot.', { id: toastId }))
      .finally(() => setWifiLoading(false));
  }, [refreshWifiStatus]);

  const startStreaming = useCallback(() => {
    setStreamLoading(true);
    const toastId = toast.loading('Starting stream...');
    callBackend('StartStreaming')
      .then((res) => {
        if (res && res.success) {
          toast.success('Streaming started.', { id: toastId });
          return refreshStreamStatus();
        }
        toast.error('Failed to start streaming.', { id: toastId });
      })
      .catch(() => toast.error('Failed to start streaming.', { id: toastId }))
      .finally(() => setStreamLoading(false));
  }, [refreshStreamStatus]);

  const stopStreaming = useCallback(() => {
    setStreamLoading(true);
    const toastId = toast.loading('Stopping stream...');
    callBackend('StopStreaming')
      .then((res) => {
        if (res && res.success) {
          toast.success('Streaming stopped.', { id: toastId });
          return refreshStreamStatus();
        }
        toast.error('Failed to stop streaming.', { id: toastId });
      })
      .catch(() => toast.error('Failed to stop streaming.', { id: toastId }))
      .finally(() => setStreamLoading(false));
  }, [refreshStreamStatus]);

  // Timecode
  const formatTimecodeFromFrames = useCallback((totalFrames, fps) => {
    const safeFPS = Math.max(1, Math.round(fps || 24));
    const frames = Math.max(0, Math.floor(totalFrames || 0));
    const framePart = (frames % safeFPS).toString().padStart(2, '0');
    const totalSeconds = Math.floor(frames / safeFPS);
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    const minutes = (Math.floor(totalSeconds / 60) % 60).toString().padStart(2, '0');
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}:${framePart}`;
  }, []);

  useEffect(() => {
    if (isRecording) {
      recordRunStartMsRef.current = Date.now();
      recordRunStartFpsRef.current = Math.max(1, Number(settings.fps) || 24);
      return;
    }
    recordRunStartMsRef.current = null;
  }, [isRecording, settings.fps]);

  const toggleRecording = useCallback(() => {
    const stopping = isRecording;
    if (stopping) setIsFinalizing(true);
    return callBackend('ToggleRecording')
      .then((recording) => {
        setIsRecording(recording);
        return callBackend('GetConfig')
          .then((cfg) => {
            if (!cfg) return;
            setSettings((prev) => {
              if (recording) return cfg;
              return { ...cfg, timecodeFrames: Math.max(prev.timecodeFrames || 0, cfg.timecodeFrames || 0) };
            });
          })
          .catch(() => {});
      })
      .finally(() => {
        if (stopping) {
          setIsFinalizing(false);
          toast.success('Recording finalized.');
        }
      });
  }, [isRecording]);

  useEffect(() => {
    let interval;
    if (isRecording) {
      const baseFrames = Math.max(0, Math.floor(settings.timecodeFrames || 0));
      interval = setInterval(() => {
        const startMs = recordRunStartMsRef.current || Date.now();
        const elapsedMs = Date.now() - startMs;
        const liveFrames = Math.max(0, Math.round((elapsedMs / 1000) * recordRunStartFpsRef.current));
        setTimecode(formatTimecodeFromFrames(baseFrames + liveFrames, settings.fps));
      }, Math.max(16, Math.floor(1000 / Math.max(1, settings.fps || 24))));
    } else {
      setTimecode(formatTimecodeFromFrames(settings.timecodeFrames || 0, settings.fps));
    }
    return () => clearInterval(interval);
  }, [isRecording, settings.fps, settings.timecodeFrames, formatTimecodeFromFrames]);


  if (fatalError) return <div className="h-screen bg-red-950 flex flex-col items-center justify-center p-8 text-white font-mono text-center"><X className="w-16 h-16 mb-4 text-red-500" /><h1 className="text-xl font-bold uppercase mb-2">Fatal UI Error</h1><div className="bg-black/40 p-4 rounded-lg max-w-lg border border-red-500/30">{fatalError}</div><button onClick={() => window.location.reload()} className="mt-8 px-6 py-2 bg-white text-black font-bold uppercase rounded-full hover:bg-zinc-200">Reload Interface</button></div>;

  if (!isLoaded) return <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 text-accent-blue gap-4"><Camera className="w-12 h-12 animate-pulse" /><div className="text-[10px] font-bold uppercase tracking-widest animate-pulse">Initializing Hardware...</div>{!isWails && <div className="text-[8px] text-zinc-600 font-mono mt-4">Connected to {window.location.host}</div>}</div>;

  return (
    <div className="antialiased select-none touch-none bg-zinc-950 min-h-screen">
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3200,
          style: {
            background: '#111827',
            color: '#E5E7EB',
            border: '1px solid #374151',
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.02em'
          }
        }}
      />
      <AnimatePresence mode="wait">
        <motion.div key={orientation} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="relative w-full h-screen overflow-hidden">
          {orientation === 'landscape' ? <LandscapeLayout compact={compactLandscape} settings={settings} setSettings={setSettings} activeQuickSetting={activeQuickSetting} setActiveQuickSetting={setActiveQuickSetting} isRecording={isRecording} toggleRecording={toggleRecording} timecode={timecode} setActiveTab={setActiveTab} setShowSettings={setShowSettings} systemStats={systemStats} audioLevels={audioLevels} wifiStatus={wifiStatus} /> : <PortraitLayout settings={settings} setSettings={setSettings} activeQuickSetting={activeQuickSetting} setActiveQuickSetting={setActiveQuickSetting} isRecording={isRecording} toggleRecording={toggleRecording} timecode={timecode} setActiveTab={setActiveTab} setShowSettings={setShowSettings} systemStats={systemStats} audioLevels={audioLevels} wifiStatus={wifiStatus} />}
          <AnimatePresence>{activeQuickSetting && <QuickPicker activeQuickSetting={activeQuickSetting} settings={settings} setSettings={setSettings} setActiveQuickSetting={setActiveQuickSetting} position={activeQuickSetting.position} dynamicOptions={{ audioDevice: audioDevices }} />}</AnimatePresence>
          <AnimatePresence>{showSettings && <SettingsOverlay orientation={orientation} activeTab={activeTab} setActiveTab={setActiveTab} setShowSettings={setShowSettings} settings={settings} setSettings={setSettings} setActiveQuickSetting={setActiveQuickSetting} systemStats={systemStats} audioLevels={audioLevels} wifiStatus={wifiStatus} wifiNetworks={wifiNetworks} wifiSSID={wifiSSID} setWifiSSID={setWifiSSID} wifiPassword={wifiPassword} setWifiPassword={setWifiPassword} wifiLoading={wifiLoading} wifiMessage={wifiMessage} onWifiScan={scanWifi} onWifiConnect={connectWifi} onHotspotStart={startHotspot} onHotspotStop={stopHotspot} streamStatus={streamStatus} onStreamStart={startStreaming} onStreamStop={stopStreaming} streamLoading={streamLoading} />}</AnimatePresence>
          <AnimatePresence>{isFinalizing && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[120] bg-zinc-950 flex items-center justify-center"><div className="px-7 py-5 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-sm font-semibold uppercase tracking-widest flex items-center gap-3"><div className="w-4 h-4 rounded-full border-2 border-zinc-500 border-t-white animate-spin" />Finalizing recording...</div></motion.div>}</AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default App;
