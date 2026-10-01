import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "Pracownia Demo", short_name: "Pracownia Demo",
    description: "Twoja pracownia złotnicza — wyceny i realizacje zapisane lokalnie.",
    lang: "pl", start_url: "/", scope: "/", display: "standalone",
    theme_color: "#242823", background_color: "#f6f5f1",
    icons: [192, 512].map(size => ({ src: `/pwa/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" })),
  };
}
