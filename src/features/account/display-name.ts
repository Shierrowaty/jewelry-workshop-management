const names: Readonly<Record<string, string>> = {
  "demo@example.invalid": "Demo",
  "workshop@example.invalid": "Pracownia",
};
export function displayName(email: string) { const key = email.trim().toLowerCase(); return Object.hasOwn(names, key) ? names[key] : null; }
export function greeting(email?: string) {
  const name = email ? displayName(email) : null;
  return { title: name ? `Witaj, ${name} 👋` : "Witaj 👋", subtitle: name ? "Miło Cię znów widzieć" : "Miło Cię widzieć" };
}
