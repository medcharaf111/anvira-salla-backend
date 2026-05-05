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
export async function summarizeConversation(
  ctx: ConversationContext
): Promise<{ text: string; source: "gemini" | "fallback" }> {
  const transcript = ctx.history
    .map((m) => `${m.direction === "in" ? "العميل" : "العيادة"}: ${m.body}`)
    .join("\n");

  const prompt = `لخّص المحادثة التالية في 3 نقاط قصيرة ومركّزة (سطر لكل نقطة) باللغة العربية:
- نقطة الطلب الرئيسية للعميل
- الحالة الحالية والإجراء المطلوب
- أي تفصيل مهم لاحظته

المحادثة:
${transcript}

رد بالنقاط الثلاثة فقط، بصيغة:
١. ...
٢. ...
٣. ...`;

  const fallback = `١. عميل تواصل عبر الواتساب باستفسار.
٢. الحالة: المحادثة مفتوحة، يحتاج متابعة.
٣. (تعذّر إنشاء الملخص الذكي حالياً، استخدم النص الكامل للمحادثة)`;

  return await generate(prompt, fallback);
}

export interface SentimentAnalysis {
  positive: number;
  neutral: number;
  negative: number;
  source: "gemini" | "fallback";
}

export async function classifySentimentBatch(
  conversations: { id: string; lastMessage: string }[]
): Promise<{
  byId: Record<string, "positive" | "neutral" | "negative">;
  source: "gemini" | "fallback";
}> {
  if (conversations.length === 0) {
    return { byId: {}, source: "fallback" };
  }
  const list = conversations
    .map((c, i) => `${i + 1}. [${c.id}] "${c.lastMessage}"`)
    .join("\n");
  const prompt = `صنّف نبرة كل رسالة من رسائل العملاء التالية إلى واحدة من ثلاث:
- positive (راضٍ، شاكر، حماسي)
- neutral (سؤال، استفسار، حيادي)
- negative (شكوى، مستاء، غاضب)

الرسائل:
${list}

رد بصيغة JSON فقط، object بالـ id كمفتاح والتصنيف كقيمة. مثال:
{"abc-123": "positive", "def-456": "neutral"}`;

  const fallbackJson = JSON.stringify(
    Object.fromEntries(conversations.map((c) => [c.id, "neutral"]))
  );

  const result = await generate(prompt, fallbackJson);
  try {
    const cleaned = result.text.replace(/```(?:json)?/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, string>;
    const byId: Record<string, "positive" | "neutral" | "negative"> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const norm = String(v).toLowerCase();
      if (norm === "positive" || norm === "negative" || norm === "neutral") {
        byId[k] = norm;
      } else {
        byId[k] = "neutral";
      }
    }
    return { byId, source: result.source };
  } catch {
    return {
      byId: Object.fromEntries(
        conversations.map((c) => [c.id, "neutral" as const])
      ),
      source: "fallback",
    };
  }
}

export async function extractTopQuestions(
  customerMessages: string[]
): Promise<{ questions: string[]; source: "gemini" | "fallback" }> {
  if (customerMessages.length === 0) {
    return { questions: [], source: "fallback" };
  }
  const sample = customerMessages.slice(-30).join("\n- ");
  const prompt = `هذه رسائل عملاء وردت على الواتساب لمتجر إلكتروني:
- ${sample}

استخرج أكثر ٥ أسئلة أو طلبات تكراراً (موضوع متكرر، مثلاً: "موعد الشحن"، "السعر"، "المقاسات"...)
رد بصيغة قائمة مرقّمة باللغة العربية، كل سطر سؤال أو موضوع واحد فقط، بدون شرح.
١. ...
٢. ...`;

  const fallback = `١. الاستفسار عن أسعار المنتجات
٢. وقت الشحن
٣. توفر المنتج
٤. استرجاع الطلب
٥. طرق الدفع`;

  const result = await generate(prompt, fallback);
  const lines = result.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[\d٠-٩]+[).\s-]+/, "").trim())
    .filter((l) => l.length > 2);
  return { questions: lines.slice(0, 5), source: result.source };
}

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
