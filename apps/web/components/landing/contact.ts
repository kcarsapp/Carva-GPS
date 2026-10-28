// Contact details shown on the landing page. Leave `whatsapp` null until a
// number is confirmed - the WhatsApp buttons only render when it is set.
// Format: international digits only, no "+" or spaces (e.g. "9647501234567").

export const CONTACT = {
  email: "contact@carvarent.com",
  whatsapp: null as string | null,
};

export function whatsappHref(text?: string): string | null {
  if (!CONTACT.whatsapp) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${CONTACT.whatsapp}${q}`;
}
