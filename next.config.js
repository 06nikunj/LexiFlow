/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: "canvas" }]
    return config
  },
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"]
  }
}

module.exports = nextConfig