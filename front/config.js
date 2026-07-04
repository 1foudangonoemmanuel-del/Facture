const isLocalDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const isLanDevHost =
    /^(10|192\.168)\./.test(window.location.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(window.location.hostname);

window.BRYX_CONFIG = {
    API_URL: isLocalDevHost
        ? "http://localhost:3000/api"
        : isLanDevHost
            ? `${window.location.protocol}//${window.location.hostname}:3000/api`
            : "/api",
};
