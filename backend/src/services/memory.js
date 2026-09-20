// Memory of the whole container (Node + Chromium), read from the Linux cgroup files.
// Render's free plan does not show memory graphs, so the app reports it itself.
// "Working set" = memory in use minus the reclaimable file cache (the number that matters
// for the 512 MB limit). On Windows/macOS these files do not exist and everything is null.

const fs = require("fs");

const read = (file) => {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return null;
    }
};

const toMb = (bytes) => (bytes == null ? null : Math.round(bytes / 1048576));

function workingSetBytes() {
    // cgroup v2 (current Docker/Render), then cgroup v1
    let usage = read("/sys/fs/cgroup/memory.current");
    let stat = read("/sys/fs/cgroup/memory.stat");
    let inactiveKey = "inactive_file";
    if (usage == null) {
        usage = read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
        stat = read("/sys/fs/cgroup/memory/memory.stat");
        inactiveKey = "total_inactive_file";
    }
    const used = parseInt(usage, 10);
    if (!Number.isFinite(used)) return null;

    let inactive = 0;
    if (stat) {
        const m = new RegExp(`^${inactiveKey} (\\d+)$`, "m").exec(stat);
        if (m) inactive = parseInt(m[1], 10);
    }
    return Math.max(used - inactive, 0);
}

function limitBytes() {
    const raw = (read("/sys/fs/cgroup/memory.max") || read("/sys/fs/cgroup/memory/memory.limit_in_bytes") || "").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n < 1e13 ? n : null; // "max" / huge value = no limit
}

function snapshot() {
    return { workingSetMb: toMb(workingSetBytes()), limitMb: toMb(limitBytes()) };
}

// Samples memory while a scrape runs; stop() returns the peak in MB (or null if unavailable).
function startPeakSampler(intervalMs = 500) {
    let peak = 0;
    const sample = () => {
        const b = workingSetBytes();
        if (b != null && b > peak) peak = b;
    };
    sample();
    const timer = setInterval(sample, intervalMs);
    if (timer.unref) timer.unref();
    return {
        stop() {
            clearInterval(timer);
            sample();
            return peak ? toMb(peak) : null;
        }
    };
}

module.exports = { snapshot, startPeakSampler };