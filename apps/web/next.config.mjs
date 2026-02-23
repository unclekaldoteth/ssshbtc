/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ["@sssh-btc/shared"]
  }
};

export default nextConfig;
