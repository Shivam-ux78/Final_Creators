import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: Request) {
  try {
    const {
      mode = 'generate', // 'generate' or 'enhance'
      userSubject,
      userBody,
      name,
      username,
      biography,
      category,
      followers,
      signature,
      customBrandInfo,
      commissionRate = '15%',
      buyerDiscount = '10%'
    } = await req.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const senderBrand = signature?.brandName || 'MakeAble';
    const senderName = signature?.senderName || 'MakeAble Partnerships';
    const brandSite = signature?.website || 'https://makeable.nyc';

    if (apiKey && apiKey.trim().length > 15 && !apiKey.includes('your-openai')) {
      try {
        const openai = new OpenAI({ apiKey: apiKey.trim() });
        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        if (mode === 'enhance' && userBody && userBody.trim().length > 0) {
          const enhancePrompt = `You are an expert Creator Outreach Copywriter for "${senderBrand}" (${brandSite}).
Your task is to polish, refine, and enhance the user's custom draft email message into a compelling, professional, high-converting pitch for a USA content creator.

User's Current Draft:
"${userBody}"

STRICT GUIDELINES FOR ENHANCEMENT:
1. Preserve all key details, CPM rate requests, links (such as https://makeable.nyc/creators/apply), and commission offers.
2. Fix any grammar, awkward phrasing, or typos.
3. Use clean paragraph breaks, bold bullet points, and an inviting 1-on-1 human tone.
4. Keep the subject line engaging if provided ("${userSubject || ''}"), or suggest a polished subject line if missing.

Return STRICT JSON format:
{
  "subject": "string",
  "body": "string"
}`;

          const completion = await openai.chat.completions.create({
            model,
            messages: [{ role: 'user', content: enhancePrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.75,
          });

          const resultText = completion.choices[0].message.content;
          if (resultText) {
            const parsed = JSON.parse(resultText);
            return NextResponse.json({
              success: true,
              subject: parsed.subject || userSubject || 'Collaboration Offer with MakeAble',
              body: parsed.body,
              usedAi: true
            });
          }
        }

        // Standard AI Generation
        const prompt = `You are a real human Creator Partnerships Lead at "${senderBrand}" (${brandSite}).
Write a unique, authentic, and bespoke outreach email to Instagram creator @${username || 'creator'} (${name || username || 'Creator'}).

Creator Details:
- Name: ${name || username || 'Creator'}
- Instagram Handle: @${username || 'creator'}
- Category/Niche: ${category || 'Content Creator'}
- Follower Count: ${followers || '25k'}
- Bio: "${biography || 'Lifestyle & creative creator'}"
${customBrandInfo ? `- Extra Context: ${customBrandInfo}` : ''}

Partnership Options to include:
1. Option 1: Paid Sponsored Campaign (CPM & rate-card based sponsored Reel/Post campaign - ask them to reply with rate sheet or apply online!).
2. Option 2: Affiliate Partnership (${commissionRate} recurring commission + ${buyerDiscount} follower discount + Complimentary Gifted Product Box).

Call to Action / Next Steps:
Ask them to reply directly to this email with their media kit / rate sheet / shipping address OR apply directly online at https://makeable.nyc/creators/apply.

STRICT GUIDELINES:
1. SUBJECT LINE: 
   - Write a fresh, creative, and enticing subject line highlighting the collab opportunity.
2. EMAIL BODY:
   - Write like a genuine human reaching out 1-on-1, NOT a corporate bot.
   - Outline Option 1 (Paid Sponsored Campaign based on CPM/media kit) and Option 2 (Affiliate Partner + Free Product Box).
   - Provide next steps: reply to email OR apply at https://makeable.nyc/creators/apply.
   - DO NOT write links in markdown double bracket form like [https://...](https://...). Write clean plain text URLs like https://makeable.nyc/creators/apply so they render as CTA buttons.
   - Sign-off:
     Warmly,
     ${senderName}
     https://makeable.nyc

Return STRICT JSON format:
{
  "subject": "string",
  "body": "string"
}`;

        const completion = await openai.chat.completions.create({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.85,
        });

        const resultText = completion.choices[0].message.content;
        if (resultText) {
          const parsed = JSON.parse(resultText);
          return NextResponse.json({
            success: true,
            subject: parsed.subject,
            body: parsed.body,
            usedAi: true
          });
        }
      } catch (aiErr: any) {
        console.warn('OpenAI API call failed, using dynamic generator:', aiErr.message);
      }
    }

    // Dynamic Fallback Generator
    const cleanName = name && name.trim() ? name.split(' ')[0] : (username || 'Creator');
    const niche = category ? category.toLowerCase() : 'lifestyle';
    const bioExcerpt = biography && biography.trim().length > 3 ? biography.slice(0, 45) : `${niche} content`;

    const subjects = [
      `Paid Collab + Partnership Invite for @${username || 'creator'} ✨`,
      `MakeAble x @${username || 'creator'} — Sponsored Post & Affiliate Partner Options 🤝`,
      `Collaboration Offer (Paid Sponsored Post or Affiliate + Free Gifting Kit) 📦`
    ];

    const bodyTemplates = [
      `Hey ${cleanName},

I was personally checking out your profile (@${username || 'creator'}) and our team at MakeAble really loves your work in the ${niche} space!

We would love to invite you to partner with MakeAble (https://makeable.nyc). We offer two flexible collaboration paths:

💰 **Option 1: Paid Sponsored Campaign**
• We offer competitive CPM & rate-sheet fees for sponsored Reel/Post campaigns (reply with your media kit & rate sheet!).

🛍️ **Option 2: Affiliate Partner & Free Product Box**
• **${commissionRate} Recurring Commission** on all sales via your personal link/code.
• **${buyerDiscount} Follower Discount** for your audience.
• **100% Free Product Gifting Kit** shipped straight to your door.

📩 **How to Get Started:**
• Reply directly to this email with your rate card / shipping address, OR
• Apply instantly on our creator portal: https://makeable.nyc/creators/apply

Warmly,
${senderName}
https://makeable.nyc`
    ];

    return NextResponse.json({
      success: true,
      subject: subjects[Math.floor(Math.random() * subjects.length)],
      body: bodyTemplates[0],
      usedAi: false
    });

  } catch (err: any) {
    console.error('AI Generate Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
