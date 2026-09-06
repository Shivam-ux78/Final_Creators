import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: Request) {
  try {
    const {
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
    const senderName = signature?.senderName || 'MakeAble Team';
    const brandSite = signature?.website || 'https://makeable.nyc';

    // 1. Live OpenAI Generation
    if (apiKey && apiKey.trim().length > 15 && !apiKey.includes('your-openai')) {
      try {
        const openai = new OpenAI({ apiKey: apiKey.trim() });
        const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        const prompt = `You are a real human Creator Partnerships Lead at "${senderBrand}" (${brandSite}).
Write a unique, authentic, and bespoke outreach email to an Instagram creator inviting them to collaborate.

Creator Details:
- Name: ${name || username}
- Instagram Handle: @${username}
- Category/Niche: ${category || 'Content Creator'}
- Follower Count: ${followers || '15k'}
- Bio: "${biography || 'Lifestyle & creative creator'}"
${customBrandInfo ? `- Extra Context: ${customBrandInfo}` : ''}

Partnership Terms to include:
- Creator earns: ${commissionRate} recurring commission on every product sale generated through their personal link or discount code.
- Buyer savings: An exclusive ${buyerDiscount} OFF discount code for their followers to save money on every order.
- Free Product: Complimentary free gifting package shipped immediately so they can test and review our products.
- Zero upfront costs / no fixed rate negotiations.

STRICT GUIDELINES:
1. SUBJECT LINE: 
   - DO NOT put the username or @handle in the subject line.
   - Write a fresh, creative, and high-converting subject line highlighting the collab, ${commissionRate} commission, and free product package.
   - Every subject line should be unique and enticing (vary phrasing: e.g. gifting perks, affiliate collab, exclusive partnership invite).

2. EMAIL BODY:
   - Write like a genuine human reaching out 1-on-1, NOT a corporate robot.
   - Avoid repetitive cliches. Use fresh phrasing.
   - Opening: Mention checking out their profile (@${username}) and mention specific aspects of their content or bio ("${biography || category}").
   - Offer: Clearly outline the 3 key perks using clean bullet points:
     • **${commissionRate} Recurring Commission** on all sales made via your link/code.
     • **${buyerDiscount} Audience Discount** code for your followers to save money.
     • **100% Free Product Gifting Kit** shipped directly to you to test and feature.
   - Call to Action: Low friction next step — ask them to reply with their shipping address so we can dispatch the gifting kit and setup their affiliate dashboard.
   - Sign-off:
     Warmly,
     MakeAble Team
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
          temperature: 0.95,
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

    // 2. Dynamic Fallback Generator
    const cleanName = name && name.trim() ? name.split(' ')[0] : username;
    const niche = category ? category.toLowerCase() : 'lifestyle';
    const bioExcerpt = biography && biography.trim().length > 3 ? biography.slice(0, 45) : `${niche} content`;

    const subjects = [
      `15% commission + free gifting partnership offer 🎁`,
      `Creator collab offer: 15% commission & free product box 🤝`,
      `Loved your profile — exclusive partnership offer from MakeAble ✨`,
      `Free gifting package + 15% affiliate partner offer 📦`,
      `Exclusive creator collab: 15% commission + free products 🎁`
    ];

    const bodyTemplates = [
      `Hey ${cleanName},

I was personally checking out your Instagram (@${username}) and our team at MakeAble has been searching for an authentic creator in the ${niche} space. Your work focusing on ${bioExcerpt} really stood out to us!

We would love to invite you into our **Exclusive Creator Partner Program** and send you a complimentary gifting package.

Here is what we're offering:
• **${commissionRate} Recurring Commission**: Earn ${commissionRate} on every product sold through your personalized link or discount code.
• **${buyerDiscount} Follower Discount**: An exclusive discount code for your community so they save money on every order.
• **100% Free Product Gifting Kit**: Shipped straight to your door to test, enjoy, and feature.

If you'd like to collaborate, simply reply with your shipping address and we'll get your free gifting box sent out and your affiliate portal activated immediately!

Warmly,
MakeAble Team
https://makeable.nyc`,

      `Hey ${cleanName},

Hope you're having a great week! Our team at MakeAble has been following your journey on Instagram (@${username}) and we really admire what you're creating in the ${niche} community, especially ${bioExcerpt}.

We're currently onboarding select creators for our **Affiliate Collaboration Program** and would love to partner with you and send over a free product package.

Here's how we partner:
• **${commissionRate} Recurring Commission**: You earn a full ${commissionRate} on all sales driven through your personal creator link/code.
• **${buyerDiscount} Community Discount**: A custom discount code for your audience to save on every purchase.
• **Free Product Gifting**: We ship a complimentary gifting package directly to you — no upfront costs or strings attached.

Would you be interested in joining? If so, reply with your best shipping address and we'll dispatch your package and log you into the partner dashboard!

Warmly,
MakeAble Team
https://makeable.nyc`
    ];

    const selectedSubject = subjects[Math.floor(Math.random() * subjects.length)];
    const selectedBody = bodyTemplates[Math.floor(Math.random() * bodyTemplates.length)];

    return NextResponse.json({
      success: true,
      subject: selectedSubject,
      body: selectedBody,
      usedAi: false
    });

  } catch (error: any) {
    console.error('AI Generation Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate AI pitch' },
      { status: 500 }
    );
  }
}
