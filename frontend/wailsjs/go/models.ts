export namespace main {
	
	export class CameraSettings {
	    fps: number;
	    shutter: string;
	    iso: number;
	    wb: string;
	    resolution: string;
	    codec: string;
	    denoise: string;
	    anamorphic: string;
	    shutterMode: string;
	    metering: string;
	    flicker: string;
	    sharpness: number;
	    contrast: number;
	    saturation: number;
	    bitrate: number;
	    kelvin: number;
	    audioGain: number;
	    peaking: boolean;
	    zebras: boolean;
	    falseColor: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CameraSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fps = source["fps"];
	        this.shutter = source["shutter"];
	        this.iso = source["iso"];
	        this.wb = source["wb"];
	        this.resolution = source["resolution"];
	        this.codec = source["codec"];
	        this.denoise = source["denoise"];
	        this.anamorphic = source["anamorphic"];
	        this.shutterMode = source["shutterMode"];
	        this.metering = source["metering"];
	        this.flicker = source["flicker"];
	        this.sharpness = source["sharpness"];
	        this.contrast = source["contrast"];
	        this.saturation = source["saturation"];
	        this.bitrate = source["bitrate"];
	        this.kelvin = source["kelvin"];
	        this.audioGain = source["audioGain"];
	        this.peaking = source["peaking"];
	        this.zebras = source["zebras"];
	        this.falseColor = source["falseColor"];
	    }
	}
	export class FileInfo {
	    name: string;
	    size: number;
	    date: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.date = source["date"];
	    }
	}
	export class SystemStats {
	    cpuTemp: number;
	    voltage: number;
	    diskFree: number;
	    diskTotal: number;
	    memoryFree: number;
	    isThrottled: boolean;
	    audioLevels: number[];
	    histogram: number[];
	
	    static createFrom(source: any = {}) {
	        return new SystemStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cpuTemp = source["cpuTemp"];
	        this.voltage = source["voltage"];
	        this.diskFree = source["diskFree"];
	        this.diskTotal = source["diskTotal"];
	        this.memoryFree = source["memoryFree"];
	        this.isThrottled = source["isThrottled"];
	        this.audioLevels = source["audioLevels"];
	        this.histogram = source["histogram"];
	    }
	}

}

