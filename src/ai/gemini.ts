import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

/**
 * Gemini client wrapper.
 *
 * Real implementation — uses the configured GEMINI_API_KEY. If the key is
 * absent, the helpers return safe fallbacks so the demo still functions.
 */

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  if (!config.gemini.apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

async function generate(prompt: string): Promise<string> {
  const ai = getClient();
  if (!ai) {
    return "(GEMINI_API_KEY غير مفعل — هذا رد افتراضي)";
  }
  const result = await ai.models.generateContent({
    model: config.gemini.model,
    contents: prompt,
  });
  return result.text ?? "";
}

export interface ConversationContext {
  merchantName: string;
  customerName: string | null;
  history: Array<{ direction: "in" | "out"; body: string }>;
}

/**
 * Generate 3 short Khaleeji-Arabic reply suggestions for the agent to pick from.
 * Returns an array of exactly 3 strings (or fewer if Gemini returns less).
 */
export async function suggestReplies(
  ctx: ConversationContext
): Promise<string[]> {
  const transcript = ctx.history
    .slice(-10)
    .map((m) => `${m.direction === "in" ? "العميل" : "العيادة"}: ${m.body}`)
    .join("\n");

  const prompt = `أنت مساعد خدمة عملاء لمتجر "${ctx.merchantName}".
العميل: ${ctx.customerName ?? "غير معروف"}.

المحادثة الأخيرة:
${transcript}

اقترح ٣ ردود قصيرة مختلفة (كل رد سطر أو اثنين) بأسلوب خليجي ودود ومحترف.
رد فقط بالردود الثلاثة، كل واحد على سطر، مرقمة 1. 2. 3. — بدون أي شرح إضافي.`;

  const raw = await generate(prompt);
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+[).\s-]+/, "").trim())
    .filter((l) => l.length > 2);

  return lines.slice(0, 3);
}

export interface CartRecoveryContext {
  merchantName: string;
  customerName: string | null;
  cartTotalSar: number;
  productNames: string[];
}

/**
 * Generate a single cart-recovery WhatsApp message (Khaleeji Arabic).
 */
export async function draftCartRecoveryMessage(
  ctx: CartRecoveryContext
): Promise<string> {
  const products = ctx.productNames.length
    ? ctx.productNames.join("، ")
    : "المنتجات اللي اخترتها";

  const prompt = `أنت تكتب رسالة واتساب من متجر "${ctx.merchantName}" لعميل ترك السلة بدون إكمال الطلب.

تفاصيل:
- اسم العميل: ${ctx.customerName ?? "العميل"}
- المنتجات في السلة: ${products}
- المبلغ الإجمالي: ${ctx.cartTotalSar} ريال

اكتب رسالة قصيرة (4-5 أسطر) بأسلوب خليجي ودود، تذكّره بسلته، تشير للمنتجات بالإسم،
وتشجعه على إكمال الطلب. لا تستخدم خصومات أو وعود لم يطلبها. رد بالرسالة فقط بدون مقدمات.`;

  return await generate(prompt);
}
