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

interface GenerateResult {
  text: string;
  source: "gemini" | "fallback";
}

async function generate(
  prompt: string,
  fallbackText: string,
  retries = 2
): Promise<GenerateResult> {
  const ai = getClient();
  if (!ai) {
    return { text: fallbackText, source: "fallback" };
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await ai.models.generateContent({
        model: config.gemini.model,
        contents: prompt,
      });
      const text = result.text ?? "";
      if (text.trim()) return { text, source: "gemini" };
      lastErr = new Error("empty_response");
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  console.warn("[gemini] falling back after retries:", lastErr);
  return { text: fallbackText, source: "fallback" };
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
): Promise<{ suggestions: string[]; source: "gemini" | "fallback" }> {
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

  const fallback = `1. هلا والله، شكراً للتواصل معنا 🙏 ممكن توضح طلبك أكثر؟
2. حياك الله، نحن جاهزون لمساعدتك. خبرنا وش تحتاج.
3. شاكر تواصلك. ممكن تعطينا تفاصيل أكثر عشان نقدر نخدمك بشكل أفضل؟`;

  const result = await generate(prompt, fallback);
  const lines = result.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\d+[).\s-]+/, "").trim())
    .filter((l) => l.length > 2);

  return { suggestions: lines.slice(0, 3), source: result.source };
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
): Promise<{ text: string; source: "gemini" | "fallback" }> {
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

  const fallback = `هلا ${ctx.customerName ?? "بك"} 👋

شفنا أنك بدأت طلبك من ${ctx.merchantName} بس ما اكتمل بعد. ${products} لسه بانتظارك في السلة، والإجمالي ${ctx.cartTotalSar} ر.س.

تكفى رد علينا لو احتجت أي مساعدة لإتمام الطلب 🙏`;

  return await generate(prompt, fallback);
}
