import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["react-leaflet-cluster"],
  // Dev only: hot reload (HMR) for other devices on the local network, e.g.
  // http://192.168.x.x:3000 — Next blocks the HMR websocket from
  // non-localhost origins otherwise. No effect on production builds.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
