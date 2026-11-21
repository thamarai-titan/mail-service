/** Two letters for a sender: initials of the name, or the start of the address. */
export function senderInitials(name: string | null, address: string): string {
  const words = (name ?? "").match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (address.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

/** A stable hue (0-359) per sender, so the same sender always gets the same colour. */
export function senderHue(address: string): number {
  let hash = 0;
  for (const char of address.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % 360;
}
