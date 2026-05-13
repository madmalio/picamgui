import { useState, useEffect, memo, useCallback } from 'react';
import { 
  Camera, 
  Settings, 
  Play, 
  Circle, 
  Layers, 
  Focus, 
  Battery, 
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
  Box
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// --- Constants (Raspberry Pi 4 / IMX477 Accurate) ---
const OPTIONS = {
  fps: [23.98, 24, 25, 29.97, 30, 48, 50, 60],
  shutter: ['1/24', '1/30', '1/48', '1/50', '1/60', '1/96', '1/100', '1/120', '1/250', '1/500', '1/1000', '1/2000'],
  iso: [100, 200, 400, 640, 800, 1000, 1250, 1600, 3200],
  wb: ['Auto', 'Daylight', 'Cloudy', 'Tungsten', 'Fluorescent', 'Incandescent', 'Manual'],
  kelvin: [2500, 2800, 3200, 4000, 4500, 5000, 5600, 6000, 6500, 7500, 10000],
  resolution: ['1080p', '720p', '4K (Low FPS)'],
  codec: ['H.264 (HW)', 'MJPEG', 'Raw'],
  denoise: ['Off', 'Fast', 'High Quality'],
  anamorphic: ['1.0x', '1.33x', '1.5x', '2.0x'],
  metering: ['Matrix', 'Center', 'Spot'],
  flicker: ['Off', '50Hz', '60Hz'],
  bitrate: [10, 15, 25, 35, 50],
  tint: ['-50', '-20', '-10', '0', '+10', '+20', '+50'],
  audioGain: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
};

// --- Sub-components ---

// --- Backend Bridge ---
const isWails = !!(window.go && window.go.main && window.go.main.App);

const callBackend = async (method, ...args) => {
  if (isWails) {
    return window.go.main.App[method](...args);
  }

  // Fallback to REST API for Browser Mode
  const endpoints = {
    GetSystemStats: '/api/stats',
    GetAudioLevels: '/api/audio',
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
  if (!data || data.length === 0) return <div className="w-32 h-14 glass rounded-xl" />;

  // Normalize data for 100x40 SVG viewBox
  const max = Math.max(...data, 1) || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${40 - (v / max) * 35}`);
  const path = `M 0 40 L ${points.join(' ')} L 100 40 Z`;

  return (
    <div className="w-32 h-14 glass rounded-xl overflow-hidden border border-white/10 relative">
      <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
        <path d={path} fill="url(#hist-grad)" className="transition-all duration-300 ease-in-out" />
        <defs>
          <linearGradient id="hist-grad" x1="0" y1="0" x2="0" y2="100%">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.1" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
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
        {/* dB markers can be added here if needed */}
      </div>
    ))}
  </div>
));

const LivePreview = memo(({ isRecording, settings, orientation }) => {
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const streamUrl = isWails ? "http://localhost:8081/stream" : `${window.location.origin}/stream`;

  // Only refresh the image source when exposure settings change
  useEffect(() => {
    setKey(prev => prev + 1);
    setError(false);
  }, [settings.fps, settings.iso, settings.shutter, settings.wb, settings.kelvin]);

  // Auto-reconnect loop if stream fails
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(false);
        setKey(k => k + 1);
        setRetryCount(r => r + 1);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  return (
    <div className="relative w-full h-full bg-zinc-950 flex items-center justify-center overflow-hidden">
      {/* 1. Base Video Feed */}
      {!error ? (
        <img 
          key={`${key}-${retryCount}`}
          src={streamUrl} 
          className={cn(
            "w-full h-full object-cover transition-all duration-300",
            settings.peaking && "brightness-125 contrast-150 saturate-0",
            settings.falseColor && "brightness-100 contrast-100" // Reset for filter
          )} 
          style={{ filter: settings.falseColor ? 'url(#false-color-filter)' : 'none' }}
          onError={() => setError(true)}
          alt="Camera Feed"
        />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Camera className="w-16 h-16 text-zinc-800 animate-pulse" strokeWidth={1} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">
            {isWails ? "Hardware Offline" : "Connecting to Stream..."}
          </span>
          {!isWails && <div className="text-[8px] text-zinc-800 font-mono">Attempt {retryCount + 1}</div>}
        </div>
      )}

          style={{ filter: settings.falseColor ? 'url(#false-color-filter)' : 'none' }}
          onError={() => setError(true)}
          alt="Camera Feed"
        />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <Camera className="w-16 h-16 text-zinc-800 animate-pulse" strokeWidth={1} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-700">Hardware Offline</span>
          <button 
            onClick={() => setError(false)}
            className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-800"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* 2. Technical Overlays */}
      <div className="absolute inset-0 pointer-events-none">
        {settings.zebras && (
          <div className="absolute inset-0 opacity-40 mix-blend-overlay"
               style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, #000 10px, #000 20px)' }} />
        )}

        {/* Backend now handles Focus Peaking pixels directly */}

        {settings.grid && (
          <svg className="absolute inset-0 w-full h-full stroke-white/20 stroke-[0.5px]">
            <line x1="33.33%" y1="0" x2="33.33%" y2="100%" />
            <line x1="66.66%" y1="0" x2="66.66%" y2="100%" />
            <line x1="0" y1="33.33%" x2="100%" y2="33.33%" />
            <line x1="0" y1="66.66%" x2="100%" y2="66.66%" />
            
            <line x1="48%" y1="50%" x2="52%" y2="50%" className="stroke-white/40" />
            <line x1="50%" y1="47%" x2="50%" y2="53%" className="stroke-white/40" />
          </svg>
        )}
      </div>
      
      {isRecording && (
        <div className="absolute inset-0 border-[6px] border-red-600/40 pointer-events-none animate-pulse z-20" />
      )}

      {/* False Color Legend Overlay */}
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
            <div key={item.l} className="flex items-center gap-2 bg-black/40 px-2 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-tighter whitespace-nowrap">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.c }} />
              {item.l}
            </div>
          ))}
        </div>
      )}

      <svg className="hidden">
        <defs>
          <filter id="false-color-filter">
            {/* Convert to grayscale first */}
            <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0" result="gray" />
            {/* Complex mapping for False Color using Component Transfer */}
            <feComponentTransfer in="gray">
              <feFuncR type="discrete" tableValues="0.3 0 0.5 0 1 1" />
              <feFuncG type="discrete" tableValues="0 0 0 1 1 0" />
              <feFuncB type="discrete" tableValues="0.5 1 1 0 0 0" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
    </div>
  );
});

const MediaGallery = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const refreshFiles = useCallback(() => {
    callBackend('ListCaptures')
      .then(res => {
        setFiles(res || []);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        if (!isWails) {
           // Mock for browser mode if server is down
           setFiles([
            { name: 'CLIP_20260512_120001.mp4', size: 104857600, date: '2026-05-12 12:00' },
            { name: 'CLIP_20260512_120512.mp4', size: 52428800, date: '2026-05-12 12:05' },
          ]);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    refreshFiles();
  }, [refreshFiles]);

  const deleteFile = (name) => {
    callBackend('DeleteCapture', name).then(() => refreshFiles());
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 font-bold uppercase tracking-widest animate-pulse">
        Loading Clips...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-600">
        <Play className="w-12 h-12 opacity-20" />
        <span className="font-bold uppercase tracking-widest">No Clips Recorded</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20">
      {files.map(file => (
        <div key={file.name} className="glass rounded-2xl p-4 flex flex-col gap-3 group border border-white/5">
          <div className="aspect-video bg-zinc-900 rounded-xl flex items-center justify-center relative overflow-hidden">
             <Play className="w-8 h-8 text-zinc-800 group-hover:text-accent-blue transition-colors" />
             <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 rounded text-[10px] font-bold text-white uppercase tracking-tighter">MP4</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-white truncate">{file.name}</span>
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{file.date} • {formatSize(file.size)}</span>
            </div>
            <button 
              onClick={() => deleteFile(file.name)}
              className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const TelemetryItem = memo(({ label, value, active = false, onClick }) => (
  <button 
    onClick={onClick}
    className={cn(
      "flex flex-col items-start px-3 py-1 rounded-md transition-all min-w-[60px]",
      active ? "bg-accent-blue/10 border border-accent-blue/30" : "hover:bg-zinc-800/50 border border-transparent"
    )}
  >
    <span className="telemetry-label">{label}</span>
    <span className={cn("telemetry-value text-base md:text-xl", active && "text-accent-blue")}>{value}</span>
  </button>
));

const SettingsOption = memo(({ label, value, active, onClick, icon: Icon }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center justify-between p-4 rounded-xl transition-all border w-full text-left",
      active 
        ? "bg-accent-blue/10 border-accent-blue/30 text-white" 
        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
    )}
  >
    <div className="flex items-center gap-3">
      {Icon && <Icon className={cn("w-5 h-5", active ? "text-accent-blue" : "text-zinc-500")} />}
      <span className="text-sm font-medium">{label}</span>
    </div>
    <span className={cn("text-sm font-bold", active ? "text-accent-blue" : "text-zinc-500")}>{value}</span>
  </button>
));

const Toggle = ({ active, onClick }) => (
  <button 
    onClick={onClick}
    className={cn(
      "w-12 h-6 rounded-full relative p-1 transition-colors",
      active ? "bg-accent-blue" : "bg-zinc-800"
    )}
  >
    <motion.div 
      animate={{ x: active ? 24 : 0 }}
      className="w-4 h-4 bg-white rounded-full shadow-sm"
    />
  </button>
);

const QuickPicker = ({ activeQuickSetting, settings, setSettings, setActiveQuickSetting }) => (
  <>
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setActiveQuickSetting(null)}
      className="absolute inset-0 z-[60] bg-black/40 backdrop-blur-sm"
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 10 }}
      className="absolute inset-x-4 md:inset-x-12 top-1/2 -translate-y-1/2 z-[70] p-1 glass rounded-2xl flex items-center justify-between overflow-hidden shadow-2xl"
    >
      <div className="flex-1 flex items-center gap-1 px-2 h-16 overflow-x-auto no-scrollbar">
        {OPTIONS[activeQuickSetting]?.map((val) => (
          <button
            key={val}
            onClick={() => {
              setSettings({ ...settings, [activeQuickSetting]: val });
              setActiveQuickSetting(null);
            }}
            className={cn(
              "px-6 h-12 rounded-xl text-sm font-bold transition-all shrink-0",
              settings[activeQuickSetting] === val 
                ? "bg-accent-blue text-white shadow-lg shadow-accent-blue/30 scale-105" 
                : "text-zinc-500 hover:text-white hover:bg-zinc-800"
            )}
          >
            {typeof val === 'number' && activeQuickSetting === 'bitrate' ? `${val}M` : 
             typeof val === 'number' && activeQuickSetting === 'kelvin' ? `${val}K` : 
             typeof val === 'number' && activeQuickSetting === 'audioGain' ? `${val}%` : 
             val}
          </button>
        ))}
      </div>
      <div className="h-8 w-px bg-zinc-800 mx-2" />
      <button 
        onClick={() => setActiveQuickSetting(null)}
        className="p-4 rounded-xl hover:bg-zinc-800 text-zinc-500 transition-colors"
      >
        <X className="w-6 h-6" />
      </button>
    </motion.div>
  </>
);

const SettingsOverlay = ({ 
  orientation, 
  activeTab, 
  setActiveTab, 
  setShowSettings, 
  settings, 
  setSettings,
  setActiveQuickSetting,
  systemStats
}) => {
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);
  const diskTotalGB = (systemStats.diskTotal / (1024 ** 3)).toFixed(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: orientation === 'landscape' ? 0 : 100, scale: orientation === 'landscape' ? 1.05 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: orientation === 'landscape' ? 0 : 100, scale: orientation === 'landscape' ? 1.05 : 1 }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="absolute inset-0 z-50 bg-zinc-950 flex flex-col md:rounded-t-3xl overflow-hidden border-t border-zinc-800"
    >
      <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-900 bg-zinc-950 shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold tracking-tight text-white uppercase">
            {activeTab === 'media' ? 'Media Gallery' : 'Camera Settings'}
          </h2>
          <div className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">v2.0 Pi4 HQ</div>
        </div>
        <button 
          onClick={() => setShowSettings(false)}
          className="p-2 hover:bg-zinc-900 rounded-full transition-colors"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-20 md:w-48 border-r border-zinc-900 flex flex-col gap-2 p-2 shrink-0">
          {[
            { id: 'camera', icon: Camera, label: 'Camera' },
            { id: 'media', icon: Play, label: 'Media' },
            { id: 'recording', icon: Circle, label: 'Record' },
            { id: 'audio', icon: Mic2, label: 'Audio' },
            { id: 'monitoring', icon: Eye, label: 'Monitor' },
            { id: 'system', icon: Cpu, label: 'System' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex flex-col md:flex-row items-center gap-3 p-3 md:px-4 rounded-xl transition-all",
                activeTab === tab.id 
                  ? "bg-accent-blue text-white shadow-lg shadow-accent-blue/20" 
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              )}
            >
              <tab.icon className="w-6 h-6 shrink-0" />
              <span className="hidden md:block text-sm font-bold uppercase tracking-wider">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-hidden bg-zinc-950 relative">
          <div className="absolute inset-0 overflow-y-auto p-6">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="h-full"
              >
                {activeTab === 'camera' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h3 className="telemetry-label mb-2 text-accent-blue">Exposure Control</h3>
                      <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                        <span className="text-sm font-medium">180° Shutter Rule</span>
                        <Toggle active={settings.shutterMode === '180'} onClick={() => updateSetting('shutterMode', settings.shutterMode === '180' ? 'manual' : '180')} />
                      </div>
                      <SettingsOption label="ISO (Analog Gain)" value={settings.iso} onClick={() => setActiveQuickSetting('iso')} active />
                      <SettingsOption label="Shutter Speed" value={settings.shutterMode === '180' ? 'AUTO (180°)' : settings.shutter} onClick={() => settings.shutterMode !== '180' && setActiveQuickSetting('shutter')} />
                      <SettingsOption label="WB Preset" value={settings.wb} onClick={() => setActiveQuickSetting('wb')} active />
                      {settings.wb === 'Manual' && (
                        <SettingsOption label="Kelvin" value={`${settings.kelvin}K`} onClick={() => setActiveQuickSetting('kelvin')} active />
                      )}
                      <SettingsOption label="Tint" value={settings.tint} onClick={() => setActiveQuickSetting('tint')} />
                    </div>
                    <div className="space-y-4">
                      <h3 className="telemetry-label mb-2 text-accent-blue">Sensor Mode</h3>
                      <SettingsOption label="Resolution" value={settings.resolution} onClick={() => setActiveQuickSetting('resolution')} active />
                      <SettingsOption label="Frame Rate" value={`${settings.fps} fps`} onClick={() => setActiveQuickSetting('fps')} active />
                      <SettingsOption label="Flicker Reduction" value={settings.flicker} onClick={() => setActiveQuickSetting('flicker')} />
                      <SettingsOption label="Anamorphic" value={settings.anamorphic} onClick={() => setActiveQuickSetting('anamorphic')} />
                    </div>
                  </div>
                )}

                {activeTab === 'media' && (
                  <MediaGallery />
                )}

                {activeTab === 'audio' && (
                  <div className="space-y-8 max-w-2xl">
                    <h3 className="telemetry-label mb-2 text-accent-blue">Audio Configuration</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsOption label="Input Gain" value={`${settings.audioGain}%`} onClick={() => setActiveQuickSetting('audioGain')} active />
                      <SettingsOption label="Input Source" value="USB Audio Device" />
                      <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                        <span className="text-sm font-medium text-white">Phantom Power (+48V)</span>
                        <Toggle active={false} onClick={() => {}} />
                      </div>
                      <div className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                        <span className="text-sm font-medium text-white">Low Cut Filter</span>
                        <Toggle active={true} onClick={() => {}} />
                      </div>
                    </div>
                    
                    <div className="mt-8 p-6 rounded-2xl bg-zinc-900 border border-zinc-800">
                       <div className="flex items-center gap-4 mb-6">
                          <Mic2 className="w-6 h-6 text-accent-blue" />
                          <div>
                            <h4 className="font-bold uppercase tracking-tight">Level Monitor</h4>
                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">L/R Peak Meter</p>
                          </div>
                       </div>
                       <VUMeter levels={audioLevels} />
                    </div>
                  </div>
                )}

                {activeTab === 'recording' && (
                  <div className="space-y-4 max-w-2xl">
                    <h3 className="telemetry-label mb-2 text-accent-blue">Recording Pipeline</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsOption label="Codec" value={settings.codec} onClick={() => setActiveQuickSetting('codec')} active />
                      <SettingsOption label="Bitrate" value={`${settings.bitrate} Mbps`} onClick={() => setActiveQuickSetting('bitrate')} active />
                      <SettingsOption label="Format" value="H.264 High" />
                      <SettingsOption label="Container" value="MP4" />
                    </div>
                    <div className="mt-8 p-6 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center gap-4">
                        <div className="p-3 bg-accent-blue/10 rounded-xl shrink-0">
                          <HardDrive className="w-6 h-6 text-accent-blue" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold uppercase tracking-tight truncate">Storage Mount</h4>
                          <div className="w-full h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                             <div className="h-full bg-accent-blue" style={{ width: `${(systemStats.diskTotal - systemStats.diskFree) / systemStats.diskTotal * 100}%` }} />
                          </div>
                          <p className="text-[10px] text-zinc-500 mt-2 uppercase font-bold tracking-widest truncate">{diskFreeGB}GB Free of {diskTotalGB}GB</p>
                        </div>
                    </div>
                  </div>
                )}

                {activeTab === 'monitoring' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h3 className="telemetry-label text-accent-blue">HUD Overlays</h3>
                        {[
                          { id: 'peaking', label: 'Focus Peaking', icon: Focus },
                          { id: 'zebras', label: 'Exposure Zebras', icon: Activity },
                          { id: 'falseColor', label: 'False Color', icon: Box },
                          { id: 'histogram', label: 'Real-time Histogram', icon: SlidersHorizontal },
                          { id: 'grid', label: 'Grid Guides', icon: Layers }
                        ].map(tool => (
                          <div key={tool.id} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                            <div className="flex items-center gap-3 text-zinc-300">
                              <tool.icon className="w-5 h-5" />
                              <span className="text-sm font-medium">{tool.label}</span>
                            </div>
                            <Toggle active={settings[tool.id]} onClick={() => updateSetting(tool.id, !settings[tool.id])} />
                          </div>
                        ))}
                      </div>
                      <div className="space-y-4">
                        <h3 className="telemetry-label text-accent-blue">Monitor Logic</h3>
                        <SettingsOption label="3D LUT" value={settings.lut} active />
                        <SettingsOption label="Grid Guides" value="Rule of Thirds" />
                      </div>
                  </div>
                )}

                {activeTab === 'system' && (
                  <div className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                       <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
                          <div className="flex items-center gap-2 text-orange-500 mb-2">
                             <Thermometer className="w-4 h-4" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">CPU Temp</span>
                          </div>
                          <span className="text-2xl font-mono">{systemStats.cpuTemp.toFixed(1)}°C</span>
                       </div>
                       <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
                          <div className="flex items-center gap-2 text-green-500 mb-2">
                             <Zap className="w-4 h-4" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">Voltage</span>
                          </div>
                          <span className="text-2xl font-mono">{systemStats.voltage.toFixed(2)}V</span>
                       </div>
                       <div className="p-4 rounded-2xl bg-zinc-900 border border-zinc-800">
                          <div className="flex items-center gap-2 text-accent-blue mb-2">
                             <Cpu className="w-4 h-4" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">Memory</span>
                          </div>
                          <span className="text-2xl font-mono">{systemStats.memoryFree.toFixed(1)}GB</span>
                       </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <button className="p-4 bg-red-600/10 border border-red-600/20 text-red-500 rounded-xl font-bold uppercase text-xs hover:bg-red-600/20 transition-all">Shut Down System</button>
                       <button className="p-4 bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-xl font-bold uppercase text-xs hover:bg-zinc-700 transition-all">Reboot Camera</button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const LandscapeLayout = memo(({ 
  settings, 
  setSettings,
  activeQuickSetting, 
  setActiveQuickSetting, 
  isRecording, 
  toggleRecording, 
  timecode, 
  setActiveTab, 
  setShowSettings,
  systemStats,
  audioLevels
}) => {
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);

  return (
    <div className="relative w-full h-screen flex flex-col overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-16 glass flex items-center justify-between px-6 z-20">
        <div className="flex gap-4">
          <TelemetryItem 
            label="FPS" 
            value={settings.fps} 
            active={activeQuickSetting === 'fps'}
            onClick={() => setActiveQuickSetting(activeQuickSetting === 'fps' ? null : 'fps')} 
          />
          <TelemetryItem 
            label="Shutter" 
            value={settings.shutterMode === '180' ? 'AUTO (180°)' : settings.shutter} 
            active={activeQuickSetting === 'shutter'}
            onClick={() => settings.shutterMode !== '180' && setActiveQuickSetting(activeQuickSetting === 'shutter' ? null : 'shutter')} 
          />
        </div>
        
        <div className="flex flex-col items-center">
          <span className={cn(
            "text-2xl font-mono tracking-widest font-bold",
            isRecording ? "text-red-500" : "text-white"
          )}>
            {timecode}
          </span>
          <div className="flex items-center gap-2 mt-[-4px]">
            <div className={cn("w-2 h-2 rounded-full", isRecording ? "bg-red-600 animate-pulse" : "bg-zinc-700")} />
            <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-400 uppercase">
              {isRecording ? "Recording" : "Standby"}
            </span>
          </div>
        </div>

        <div className="flex gap-4">
          <TelemetryItem 
            label="ISO" 
            value={settings.iso} 
            active={activeQuickSetting === 'iso'}
            onClick={() => setActiveQuickSetting(activeQuickSetting === 'iso' ? null : 'iso')} 
          />
          <TelemetryItem 
            label="WB" 
            value={settings.wb === 'Manual' ? `${settings.kelvin}K` : settings.wb} 
            active={activeQuickSetting === 'wb' || activeQuickSetting === 'kelvin'}
            onClick={() => {
              if (settings.wb === 'Manual') {
                setActiveQuickSetting(activeQuickSetting === 'kelvin' ? 'wb' : 'kelvin');
              } else {
                setActiveQuickSetting(activeQuickSetting === 'wb' ? null : 'wb');
              }
            }} 
          />
          <TelemetryItem 
            label="Tint" 
            value={settings.tint} 
            active={activeQuickSetting === 'tint'}
            onClick={() => setActiveQuickSetting(activeQuickSetting === 'tint' ? null : 'tint')} 
          />
        </div>
      </div>

      <div className="flex-1 relative bg-zinc-900 overflow-hidden flex items-center justify-center">
        <LivePreview isRecording={isRecording} settings={settings} orientation="landscape" />

        <div className="absolute left-6 top-24 bottom-6 w-12 flex flex-col gap-4">
          <button onClick={() => updateSetting('peaking', !settings.peaking)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.peaking ? "text-accent-blue border-accent-blue/40" : "text-white/60")} title="Focus Peaking"><Focus className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('zebras', !settings.zebras)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.zebras ? "text-accent-blue border-accent-blue/40" : "text-white/60")} title="Zebras"><Activity className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('falseColor', !settings.falseColor)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.falseColor ? "text-accent-blue border-accent-blue/40" : "text-white/60")} title="False Color"><Box className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('histogram', !settings.histogram)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.histogram ? "text-accent-blue border-accent-blue/40" : "text-white/60")} title="Histogram"><SlidersHorizontal className="w-6 h-6" /></button>
          <button onClick={() => updateSetting('grid', !settings.grid)} className={cn("p-3 glass rounded-xl btn-tactile transition-colors", settings.grid ? "text-accent-blue border-accent-blue/40" : "text-white/60")} title="Grid"><Layers className="w-6 h-6" /></button>
        </div>

        {settings.histogram && (
          <div className="absolute left-24 bottom-24 z-10">
            <Histogram data={systemStats.histogram} />
          </div>
        )}

      <div className="absolute right-6 top-24 bottom-6 flex flex-col justify-center gap-8">
         <button 
          onClick={toggleRecording}
          className="group relative flex items-center justify-center"
         >
            <div className="absolute w-20 h-20 border-2 border-white/20 rounded-full group-active:scale-90 transition-transform" />
            <div className={cn(
              "w-16 h-16 rounded-full transition-all flex items-center justify-center shadow-lg shadow-red-900/20",
              isRecording ? "bg-red-600 rounded-xl scale-90" : "bg-red-600 scale-100"
            )}>
               {!isRecording && <Circle className="fill-white text-white w-6 h-6" />}
            </div>
         </button>
         <button 
          onClick={() => { setActiveTab('camera'); setShowSettings(true); }}
          className="p-4 glass rounded-full btn-tactile flex items-center justify-center"
         >
            <Settings className="w-7 h-7 text-white/80" />
         </button>
      </div>


        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-96 h-12 glass rounded-lg flex items-center px-4 gap-4">
            <Mic2 className="w-4 h-4 text-zinc-500" />
            <VUMeter levels={audioLevels} />
            <span className="text-[10px] font-mono text-zinc-400 whitespace-nowrap">-12dB</span>
        </div>

        <div className="absolute bottom-6 right-8 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
           {diskFreeGB}GB FREE
        </div>
      </div>
    </div>
  );
});

const PortraitLayout = memo(({ 
  settings, 
  setSettings,
  activeQuickSetting, 
  setActiveQuickSetting, 
  isRecording, 
  toggleRecording, 
  timecode, 
  setActiveTab, 
  setShowSettings,
  systemStats,
  audioLevels
}) => {
  const updateSetting = (key, val) => setSettings(prev => ({ ...prev, [key]: val }));
  const diskFreeGB = (systemStats.diskFree / (1024 ** 3)).toFixed(1);

  return (
    <div className="relative w-full h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <div className="p-4 pt-10 flex justify-between items-center bg-zinc-950 shrink-0">
        <div className="flex items-center gap-2 text-green-500">
          <Battery className="w-5 h-5" />
          <span className="text-[10px] font-bold uppercase tracking-widest">100%</span>
        </div>
        <div className="flex flex-col items-center">
          <span className={cn(
            "text-xl font-mono font-bold tracking-wider leading-none",
            isRecording ? "text-red-500" : "text-white"
          )}>
            {timecode}
          </span>
          <div className="flex items-center gap-1 mt-1">
             <div className={cn("w-1.5 h-1.5 rounded-full", isRecording ? "bg-red-600 animate-pulse" : "bg-zinc-700")} />
             <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-tighter">PREVIEW</span>
          </div>
        </div>
        <button 
          onClick={() => { setActiveTab('camera'); setShowSettings(true); }}
          className="p-2 glass rounded-lg text-zinc-400 hover:text-white"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-zinc-900 relative border-y border-zinc-900 overflow-hidden flex items-center justify-center mx-2 rounded-2xl">
         <LivePreview isRecording={isRecording} settings={settings} orientation="portrait" />
        <div className="absolute top-4 left-4 glass px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-white/10">Live</div>
        
        {settings.histogram && (
          <div className="absolute bottom-4 left-4 z-10 scale-75 origin-bottom-left">
            <Histogram data={systemStats.histogram} />
          </div>
        )}

        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
           <button onClick={() => updateSetting('peaking', !settings.peaking)} className={cn("p-2 glass rounded-lg transition-colors", settings.peaking ? "text-accent-blue" : "text-white/60")}><Focus className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('zebras', !settings.zebras)} className={cn("p-2 glass rounded-lg transition-colors", settings.zebras ? "text-accent-blue" : "text-white/60")}><Activity className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('falseColor', !settings.falseColor)} className={cn("p-2 glass rounded-lg transition-colors", settings.falseColor ? "text-accent-blue" : "text-white/60")}><Box className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('histogram', !settings.histogram)} className={cn("p-2 glass rounded-lg transition-colors", settings.histogram ? "text-accent-blue" : "text-white/60")}><SlidersHorizontal className="w-5 h-5" /></button>
           <button onClick={() => updateSetting('grid', !settings.grid)} className={cn("p-2 glass rounded-lg transition-colors", settings.grid ? "text-accent-blue" : "text-white/60")}><Layers className="w-5 h-5" /></button>
        </div>

        {/* Vertical Audio Meter for Portrait */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-1 h-32 w-4">
           {audioLevels.map((level, i) => (
             <div key={i} className="w-1 bg-zinc-900/60 rounded-full overflow-hidden flex flex-col justify-end p-[0.5px]">
                <motion.div 
                   animate={{ height: `${level * 100}%` }}
                   className={cn(
                     "w-full rounded-full",
                     level > 0.9 ? "bg-red-500" : level > 0.7 ? "bg-yellow-500" : "bg-green-500"
                   )}
                />
             </div>
           ))}
        </div>
      </div>

      <div className="p-4 pb-16 gap-4 bg-zinc-950 shrink-0">
        <div className="grid grid-cols-4 gap-1.5 mb-6">
           <TelemetryItem label="FPS" value={settings.fps} active={activeQuickSetting === 'fps'} onClick={() => setActiveQuickSetting('fps')} />
           <TelemetryItem label="ISO" value={settings.iso} active={activeQuickSetting === 'iso'} onClick={() => setActiveQuickSetting('iso')} />
           <TelemetryItem 
             label="WB" 
             value={settings.wb === 'Manual' ? `${settings.kelvin}K` : settings.wb} 
             active={activeQuickSetting === 'wb' || activeQuickSetting === 'kelvin'} 
             onClick={() => settings.wb === 'Manual' ? setActiveQuickSetting('kelvin') : setActiveQuickSetting('wb')} 
           />
           <TelemetryItem label="SHUT" value={settings.shutterMode === '180' ? '180°' : settings.shutter} active={activeQuickSetting === 'shutter'} onClick={() => settings.shutterMode !== '180' && setActiveQuickSetting('shutter')} />
        </div>

        <div className="flex items-center justify-between gap-4 px-2">
           <button className="p-4 glass rounded-2xl text-zinc-500 hover:text-white" onClick={() => { setActiveTab('monitoring'); setShowSettings(true); }}>
              <Layers className="w-6 h-6" />
           </button>

           <button 
            onClick={toggleRecording}
            className="group relative flex items-center justify-center translate-y-[-8px]"
           >
              <div className="absolute w-24 h-24 border-4 border-zinc-900 rounded-full group-active:scale-95 transition-transform" />
              <div className={cn(
                "w-16 h-16 rounded-full transition-all flex items-center justify-center shadow-2xl",
                isRecording ? "bg-red-600 rounded-xl scale-90" : "bg-red-600 scale-100"
              )}>
                 {!isRecording && <Circle className="fill-white text-white w-7 h-7" />}
              </div>
           </button>

           <div className="flex flex-col items-center gap-1">
              <span className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">{diskFreeGB}GB FREE</span>
           </div>
        </div>
      </div>
    </div>
  );
});

// --- Main App Component ---

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [timecode, setTimecode] = useState("00:00:00:00");
  const [orientation, setOrientation] = useState(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('camera');
  const [activeQuickSetting, setActiveQuickSetting] = useState(null); 
  const [audioLevels, setAudioLevels] = useState([0, 0]);

  const [systemStats, setSystemStats] = useState({
    cpuTemp: 0,
    voltage: 0,
    diskFree: 0,
    diskTotal: 1,
    memoryFree: 0
  });

  const [settings, setSettings] = useState({
    fps: 24,
    shutter: '1/48',
    shutterMode: '180',
    iso: 800,
    wb: 'Daylight',
    tint: '0',
    resolution: '1080p',
    codec: 'H.264 (HW)',
    lut: 'Rec.709',
    denoise: 'Fast',
    anamorphic: '1.0x',
    metering: 'Matrix',
    flicker: 'Off',
    bitrate: 25,
    peaking: false,
    zebras: false,
    falseColor: false,
    histogram: true,
    grid: false,
    kelvin: 5600,
    audioGain: 50
  });

  useEffect(() => {
    const handleResize = () => setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (settings.shutterMode === '180') {
      const shutterVal = Math.round(settings.fps * 2);
      setSettings(prev => ({ ...prev, shutter: `1/${shutterVal}` }));
    }
  }, [settings.fps, settings.shutterMode]);

  // Sync settings with Go backend (Debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      callBackend('UpdateConfig', settings).catch(console.error);
    }, 200); // 200ms debounce
    return () => clearTimeout(timer);
  }, [settings]);

  // System Polling
  useEffect(() => {
    const poll = () => {
      callBackend('GetSystemStats').then(setSystemStats).catch(console.error);
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Audio Polling (Faster refresh for VU meters)
  useEffect(() => {
    const pollAudio = () => {
      callBackend('GetAudioLevels').then(setAudioLevels).catch(console.error);
    };
    const interval = setInterval(pollAudio, 150); // 10fps refresh for meters
    return () => clearInterval(interval);
  }, []);

  const toggleRecording = useCallback(() => {
    callBackend('ToggleRecording').then(setIsRecording).catch(console.error);
  }, [isRecording]);

  useEffect(() => {
    let interval;
    if (isRecording) {
      const start = Date.now();
      interval = setInterval(() => {
        const diff = Date.now() - start;
        const frames = Math.floor((diff % 1000) / (1000 / settings.fps)).toString().padStart(2, '0');
        const seconds = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        const minutes = Math.floor((diff / 60000) % 60).toString().padStart(2, '0');
        const hours = Math.floor(diff / 3600000).toString().padStart(2, '0');
        setTimecode(`${hours}:${minutes}:${seconds}:${frames}`);
      }, 1000 / settings.fps);
    } else {
      setTimecode("00:00:00:00");
    }
    return () => clearInterval(interval);
  }, [isRecording, settings.fps]);

  return (
    <div className="antialiased select-none touch-none bg-zinc-950 min-h-screen">
      <AnimatePresence mode="wait">
        <motion.div
          key={orientation}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="relative w-full h-screen overflow-hidden"
        >
          {orientation === 'landscape' ? (
            <LandscapeLayout 
              settings={settings}
              setSettings={setSettings}
              activeQuickSetting={activeQuickSetting}
              setActiveQuickSetting={setActiveQuickSetting}
              isRecording={isRecording}
              toggleRecording={toggleRecording}
              timecode={timecode}
              setActiveTab={setActiveTab}
              setShowSettings={setShowSettings}
              systemStats={systemStats}
              audioLevels={audioLevels}
            />
          ) : (
            <PortraitLayout 
              settings={settings}
              setSettings={setSettings}
              activeQuickSetting={activeQuickSetting}
              setActiveQuickSetting={setActiveQuickSetting}
              isRecording={isRecording}
              toggleRecording={toggleRecording}
              timecode={timecode}
              setActiveTab={setActiveTab}
              setShowSettings={setShowSettings}
              systemStats={systemStats}
              audioLevels={audioLevels}
            />
          )}

          <AnimatePresence>
            {activeQuickSetting && (
              <QuickPicker 
                activeQuickSetting={activeQuickSetting}
                settings={settings}
                setSettings={setSettings}
                setActiveQuickSetting={setActiveQuickSetting}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSettings && (
              <SettingsOverlay 
                orientation={orientation}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                setShowSettings={setShowSettings}
                settings={settings}
                setSettings={setSettings}
                setActiveQuickSetting={setActiveQuickSetting}
                systemStats={systemStats}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default App;
