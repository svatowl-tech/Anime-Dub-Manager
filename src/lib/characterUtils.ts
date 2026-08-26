/**
 * Utility functions for character names and background grouping (gurs).
 */

/**
 * Normalizes and extracts the base name for generic background or numbered characters (e.g. "Мужчина 1" -> "Мужчина").
 * Returns the base group name, or null if it's not a background/numbered character.
 */
export function getBackgroundBaseName(name: string): string | null {
  if (!name) return null;
  const cleanName = name.trim();
  const lowercase = cleanName.toLowerCase();
  
  // Pattern to match numbers and surrounding punctuation/whitespace (e.g. " 1", " #2", "-3", " (4)")
  const numberRegex = /[\s\-_#(#)]*\d+[\s)]*/;
  const hasNumber = /\d+/.test(cleanName);
  
  const bgKeywords = [
    "мужчина", "женщина", "парень", "девушка", "дети", "ребенок", 
    "мальчик", "девочка", "человек", "люди", "толпа", "прохожий", 
    "голос", "полицейский", "охранник", "врач", "солдат", "старик", 
    "старуха", "клиент", "покупатель", "водитель", "официант", "персонаж",
    "man", "woman", "boy", "girl", "child", "crowd", "voice", "guard", "soldier", "doctor", "background", "npc"
  ];
  
  const isBgKeyword = bgKeywords.some(keyword => lowercase.includes(keyword));
  
  if (hasNumber || isBgKeyword) {
    // Strip numbers and symbols around them to find the base name
    let base = cleanName.replace(numberRegex, '').trim();
    if (!base) {
      if (hasNumber) {
        base = "Фоновый";
      } else {
        base = cleanName;
      }
    }
    
    // Capitalize first letter
    base = base.charAt(0).toUpperCase() + base.slice(1);
    
    // Consolidate similar terms
    const baseLower = base.toLowerCase();
    if (baseLower.includes("ребенок") || baseLower.includes("дети") || baseLower.includes("ребёнок")) {
      return "Дети / Ребенок";
    }
    if (baseLower.includes("мужчина") || baseLower === "муж") {
      return "Мужчина";
    }
    if (baseLower.includes("женщина") || baseLower === "жен") {
      return "Женщина";
    }
    if (baseLower.includes("парень") || baseLower.includes("молодой человек") || baseLower.includes("мальчик")) {
      return "Парень / Мальчик";
    }
    if (baseLower.includes("девушка") || baseLower.includes("девочка")) {
      return "Девушка / Девочка";
    }
    if (baseLower.includes("голос")) {
      return "Голоса";
    }
    if (baseLower.includes("охранник") || baseLower.includes("страж") || baseLower.includes("полицейский")) {
      return "Охрана / Полиция";
    }
    if (baseLower.includes("прохожий") || baseLower.includes("человек") || baseLower.includes("люди")) {
      return "Прохожие / Толпа";
    }
    
    return base;
  }
  
  return null;
}
