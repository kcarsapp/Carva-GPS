/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow importing the shared TypeScript package directly from the monorepo.
  transpilePackages: ['@carva/shared'],
};

export default nextConfig;
