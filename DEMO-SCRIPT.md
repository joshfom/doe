# Ora AI — Bayn demo script

> Hands-on guide for the team playing the Ora AI demo for management.
> Bayn is **still under construction (off-plan)** — Ora AI is the digital
> employee bridging sales, project ops, HSE, security, marketing and finance
> from day one. The same agent will become the post-handover concierge once
> units deliver.

---

## 1. How Ora identifies people

Ora has **no chat login** — identification feels like a real concierge, not a
form. The flow is:

1. **Warm greeting + discovery.** Ora opens with something like *"Hi, I'm Ora, the in-house assistant at Bayn. May I have your name, please?"* and gently collects the user's name → email → mobile across the first one or two turns.
2. **Recognition.** As soon as an email or phone is captured, Ora looks it up in `ai_clients` / `ai_tenants` and reacts naturally:
   - **Returning client** → *"Welcome back, Mr. Khalid! Always a pleasure 👋 — what can I help you with today?"*
   - **First-time visitor** → *"Lovely to meet you, Sara. How can I help?"*
   - **Ambiguous match** → *"I see a couple of accounts under that name — can you share your unit number so I pull up the right one?"*
3. **Open invitation.** Ora then asks *"What brings you in today?"* (never a menu of buttons) and adapts to the answer.
4. **Security framed as care.** Anything personal / payment / contractual triggers a polite verification step — never sterile:
   > *"Of course, happy to help with that. Quick thing first — for your security, our policy asks me to verify it's really you. I'll send a 6-digit code to b\*\*y\*r@ora-demo.com — takes a second."*
   The user pastes the code → Ora replies *"Perfect, you're verified. Now, about that mortgage NOC…"*
5. **Memory.** Once captured, name + email + phone are pinned to the conversation. Later questions don't need re-introduction; Ora just continues the conversation.
6. **Tone.** Two or three short paragraphs at most. One regional flourish per reply when it fits (*"of course"*, *"بكل سرور"*, *"happy to"*). Light, dry humour when appropriate — never about money, contracts or anything sensitive.

> **Demo trick for the actors:** the email prefix tells you the role.
> `investor@ora-demo.com`, `broker@ora-demo.com`, `contractor@ora-demo.com`,
> etc. — the actor knows who they're playing just from their address. They
> don't volunteer the email up front in scene one; they let Ora ask for it
> like a real receptionist would.

---

## 2. Persona cheat sheet

All emails are on **`@ora-demo.com`**. Phones are international format.

### Customers (chat side — talk to Ora)

| Email | Phone | Real name | What they ask about |
|---|---|---|---|
| `buyer@ora-demo.com` | +971 50 771 1000 | Hala Al Mansoori | Handover appointment, mortgage NOC, oqood, snags, payment milestones |
| `cobuyer@ora-demo.com` | +971 50 771 1001 | Ahmed Al Mansoori | Co-buyer on the same SPA — joint requests |
| `buyer2@ora-demo.com` | +971 50 771 1002 | Omar Al Hashimi | Construction progress, payment plan |
| `buyer3@ora-demo.com` | +971 50 771 1003 | Mariam Al Suwaidi (AR) | Handover docs in Arabic |
| `buyer4@ora-demo.com` | +971 50 771 1004 | Bilal Al Shamsi | Snag list, key collection |
| `investor@ora-demo.com` | +971 50 900 2233 | Sara Mendes | Brochure, payment plan, ROI |
| `investor2@ora-demo.com` | +971 50 900 2234 | Yousef Al Ahmadi (AR) | Inventory in Arabic |
| `prospect1@ora-demo.com` | +971 50 910 0001 | Layla Hassan | First-time enquiry, site visit |
| `prospect2@ora-demo.com` | +971 50 910 0002 | Nour Al Marri (AR) | Floor plans in Arabic |
| `prospect3@ora-demo.com` | +971 50 910 0003 | Rania Al Zaabi | Schools, masterplan amenities |
| `prospect4@ora-demo.com` | +971 50 910 0004 | Fatima Al Falasi (AR) | Investor walkthrough |
| `broker@ora-demo.com` | +971 50 800 1122 | Khalid Al Rashid (Crown Properties, AR) | Books site visits for clients, asks inventory |
| `broker2@ora-demo.com` | +971 50 800 1123 | Tariq Al Hosani | Broker registration, RERA |
| `tenant1@ora-demo.com` | +971 50 782 2001 | Hassan Al Ameri | Post-handover roadmap (move-in, gate pass) |
| `tenant2@ora-demo.com` | +971 50 782 2002 | Aisha Al Hashimi (AR) | Post-handover (Arabic) |
| `vendor@ora-demo.com` | +971 50 777 7301 | Karim — Stone & Surface | Material delivery slot |
| `vendor2@ora-demo.com` | +971 50 444 5566 | Dina — Greenleaf Landscaping | Vendor access, monthly maintenance |
| `contractor@ora-demo.com` | +971 50 600 0044 | Faisal — BuildRight | Hot works permit, hoist booking |
| `contractor2@ora-demo.com` | +971 50 611 1188 | Maya — SkyLine Access | Work-at-height permit |
| `consultant@ora-demo.com` | +971 50 733 3101 | Ziad — Project Consultancy | Inspection requests, civil defence |

### Ora staff (panel side — log into Ora Panel to action requests)

| Persona | Role | Where they act |
|---|---|---|
| Yousef Habib | `sales_manager` | Approves bookings, manages leads + brokers |
| Faten Mubarak | `finance` | Commissions, invoices, payment proof |
| Layla Marketing | `marketing` | Brochure deliveries, launch RSVPs |
| Omar Khan | `project_manager` | Approves NOC, hot works, handover; closes site permits |
| Mariam Saeed | `hse_officer` | Approves work-at-height, hot works on safety grounds |
| Rashid Al Suwaidi | `site_security` | Validates gate passes, scans visitor QR |
| Tala (AI) | **Ora AI** | Handles intake, OTP, identification, booking, EN/AR replies |

---

## 3. What Ora AI can do (capability map)

### Recognised intents (Ora handles end-to-end)

- **Site visit booking** — slot, OTP, calendar invite, reminders.
- **Brochure / floor plan / payment plan request** — emails the right doc in EN/AR.
- **Inventory / availability inquiry** — answers from RAG knowledge base.
- **Construction progress inquiry** — % complete, latest photos, expected handover.
- **Payment milestone reminder** — confirms next due, accepts proof reference.
- **Oqood / DLD assistance** — registration status, missing documents.
- **Mortgage NOC** — requests a draft NOC for the bank, escalates to finance.
- **Snag list submission** — collects items per location with severity.
- **Handover appointment** — books the slot, lists docs needed.
- **Hot works permit** — issues with conditions, opens HSE approval.
- **Work-at-height permit** — same flow, HSE approval required.
- **Lift / hoist usage booking** — site logistics scheduling.
- **Inspection request** — civil defence, DEWA, consultant walk-throughs.
- **Material delivery scheduling** — vendor → site security slot.
- **Vendor access** (multi-day) — opens approval.
- **Gate pass** (visitor / delivery / contractor).
- **Maintenance request, technician visit, NOC, move-in / move-out** — for the post-handover roadmap demo.
- **General inquiry** — anything not matched falls back to RAG over Bayn knowledge base.
- **Lead capture** — name / email / phone extracted automatically and pinned to the conversation.

### Cross-cutting features

- **EN / AR bilingual replies** — Ora picks language from `preferredLanguage` on the persona, or detects script in the message.
- **OTP gate** — anything personal / payment / sensitive triggers a 6-digit code to the email on file before the answer.
- **Approval routing** — NOC, move-in, vendor access, material delivery, hot works, work-at-height, handover appointment, mortgage NOC each open a `ticket_approval` row that the right panel role can decide.
- **Audit trail** — every create / status change / approval is logged in `audit_logs` with actor and diff.
- **Human handoff** — explicit "speak to a human" or repeated similar questions trigger a handoff to the relevant panel role with a conversation summary.
- **Rate limiting** — duplicate / abusive messages are throttled at the ticket layer.
- **Memory across sessions** — once contact is captured, it persists on the conversation row; later messages don't need re-introduction.

---

## 4. The demo storyboard (run order)

Run in this order — each scene takes 2–4 minutes and showcases a different role + capability. Total ≈ 25–30 minutes.

> **Style note for actors:** never dump everything in one message. Open with a
> simple greeting, let Ora ask for your name and email like a real receptionist
> would, then state your need. Ora is allowed to be warm — match the energy.
> Ad-lib freely, the dialogues below are guides, not a script.

---

### Scene 1 — Broker books a site visit (Arabic) `[broker]`

Actor: **Khalid** opens the public chat in Arabic. He does **not** volunteer his email up front.

> **Khalid:** *"السلام عليكم"*
>
> **Ora:** *"وعليكم السلام، أهلاً بك في بَيْن! أنا أورا، المساعدة الرقمية للمشروع. تشرفت، كيف أناديك؟"*
>
> **Khalid:** *"خالد الراشد، من Crown Properties."*
>
> **Ora:** *"يا هلا أستاذ خالد 👋 — تفضل، كيف أقدر أخدمك اليوم؟"*
>
> **Khalid:** *"أبغى أحجز زيارة موقع لعميل لي، يهمه Bayn Marina."*
>
> **Ora:** *"بكل سرور. عشان أربط الحجز مع حسابك، ممكن إيميلك ورقم جوالك المسجلين عندنا؟"*
>
> **Khalid:** *"broker@ora-demo.com — والجوال 0508001122."*
>
> **Ora:** *"تمام يا أستاذ خالد، أهلاً وسهلاً مرة ثانية — حسابك مع Crown Properties موجود عندي. أي يوم وأي وقت يناسب عميلك؟"*
>
> **Khalid:** *"الثلاثاء القادم، حوالي العاشرة صباحاً."*
>
> **Ora:** *"ممتاز، الثلاثاء الساعة 10 صباحاً عند gallery المبيعات في Bayn Marina. زميلنا في فريق المبيعات يوسف بيتواصل معك لتأكيد التفاصيل، وراح توصلك دعوة للتقويم على إيميلك. عميلك مرحب فيه ولو تحب أرسل لك brochure مسبقاً قبل الزيارة، قول لي."*

**System under the hood:** Ora resolved Khalid via `resolveIdentityByEmail` → opened a `site_visit_booking` ticket with his persona on file.

**Panel:** Yousef (`sales_manager`) sees the new lead in `/ora-panel/tickets` with full conversation transcript attached.

---

### Scene 2 — Investor asks for brochure (English) `[investor]`

Actor: **Sara** on the website chat. First-time visitor.

> **Sara:** *"Hi there"*
>
> **Ora:** *"Hi! I'm Ora, the in-house assistant at Bayn 👋 — may I have your name?"*
>
> **Sara:** *"Sara Mendes."*
>
> **Ora:** *"Lovely to meet you, Sara. What brings you in today?"*
>
> **Sara:** *"I'm looking at the 4-bed villas in Bayn Hills. Could you send me a brochure, the floor plans and the payment plan?"*
>
> **Ora:** *"Of course — happy to. So I can send everything to the right place, what's your best email and mobile?"*
>
> **Sara:** *"investor@ora-demo.com, +971 50 900 2233."*
>
> **Ora:** *"Got it, Sara. The Bayn Hills 4-bed villa pack is on its way to investor@ora-demo.com — brochure, floor plans for the three layouts, and the standard 60/40 payment plan. If you'd like, I can also book you a private viewing once you've had a look — just say the word."*

**System under the hood:** `brochure_request` ticket auto-opened, status `resolved`, documents listed in `requestData.documents`.

**Panel:** Layla (`marketing`) sees it logged with the conversation excerpt.

---

### Scene 3 — Booked client asks for mortgage NOC (sensitive → OTP) `[buyer]`

Actor: **Hala** — already a booked client. Watch how Ora frames the OTP as **care**, not as a hurdle.

> **Hala:** *"Hello"*
>
> **Ora:** *"Hello! I'm Ora, the in-house assistant at ORA Developers. May I have your name, please?"*
>
> **Hala:** *"Hala Al Mansoori."*
>
> **Ora:** *"Lovely to meet you, Mrs. Hala. How can I help today?"*
>
> **Hala:** *"I need a mortgage NOC for Emirates NBD against my SPA — they want it within 10 days."*
>
> **Ora:** *"Of course, happy to help with that. Could I have the email registered on your account so I pull up the right SPA?"*
>
> **Hala:** *"buyer@ora-demo.com."*
>
> **Ora:** *"Got it, Mrs. Hala — found you. Quick thing first — because this involves your contract and the bank, our policy asks me to verify it's really you. I'm sending a 6-digit code to b\*\*y\*r@ora-demo.com — should land in a few seconds."*
>
> **Hala:** *(checks inbox)* *"483921."*
>
> **Ora:** *"Perfect, you're verified ✅. I've opened a mortgage NOC request against SPA BAYN-2025-0188 for Emirates NBD, flagged urgent for the 10-day window. Faten in our finance team has been notified — she'll prepare the draft and reach out to you directly. Anything else I can take care of while we're at it?"*

**Panel:** Faten (`finance`) opens the approval, drafts the NOC, decides → Hala receives the signed NOC by email.

---

### Scene 4 — Same client asks oqood status `[buyer]`

No re-introduction needed — Hala is still in the same conversation as Scene 3.

> **Hala:** *"Oh, while you're at it — what's the status of my oqood registration?"*
>
> **Ora:** *"Of course, Mrs. Hala. You're already verified so I can pull this up right away. Your oqood file for SPA BAYN-2025-0188 is in progress — your passport copy is on file, and we're waiting on a slot at DLD. Estimated turnaround is around 7 working days. I'll keep an eye on it and ping you the moment it's issued."*

**Showcase point for management:** session memory + OTP not re-prompted.

---

### Scene 5 — Buyer asks for construction progress + photos `[buyer2]`

Actor: **Omar** — a different booked client, fresh conversation.

> **Omar:** *"Hey"*
>
> **Ora:** *"Hi! I'm Ora, the in-house assistant at Bayn. May I have your name, please?"*
>
> **Omar:** *"Omar Al Hashimi, buyer2@ora-demo.com."*
>
> **Ora:** *"Welcome back, Mr. Omar! Good to hear from you. How can I help today?"*
>
> **Omar:** *"Can you show me the latest construction progress on my unit B-1204?"*
>
> **Ora:** *"Of course — since this is unit-specific I'll just verify it's really you. Code on its way to o\*\*r@ora-demo.com."*
>
> **Omar:** *"732104."*
>
> **Ora:** *"Verified ✅. Bayn Marina Tower B is at 64% complete as of last month — façade installation on Levels 12–16 is done, MEP rough-in for your level wraps up this month. I've attached the latest April site photos for your floor and the lobby. Estimated handover for B-1204 is still on track for Q2 2027."*

---

### Scene 6 — Pre-handover snag walkthrough `[buyer4]`

Actor: **Bilal**.

> **Bilal:** *"Good morning"*
>
> **Ora:** *"Good morning! I'm Ora, the in-house assistant at ORA Developers. May I have your name, please?"*
>
> **Bilal:** *"Bilal Al Shamsi."*
>
> **Ora:** *"Lovely to meet you, Mr. Bilal. How can I help today?"*
>
> **Bilal:** *"I did the pre-handover walkthrough yesterday on M-0801 with your engineer. I have a couple of snags to log."*
>
> **Ora:** *"Of course — happy to take care of that. Since this is tied to your unit, could I have the email registered on your account so I pull up the right file?"*
>
> **Bilal:** *"buyer4@ora-demo.com."*
>
> **Ora:** *"Got it, Mr. Bilal — found you. Better to catch the snags now than after handover. Go ahead, I'll capture each one."*
>
> **Bilal:** *"Hairline crack on the master bath wall tile next to the vanity. And the south wall of the living room has visible roller marks."*
>
> **Ora:** *"Got it. Two items logged on your snag list — tile crack in master bath (medium) and paint finish on the south living-room wall (low). The project team will assess this week and come back with a fix-by date. Anything else from the walkthrough I should add?"*

**Panel:** Omar (`project_manager`) sees both items in the snag queue with photos slot ready.

---

### Scene 7 — Booking the handover appointment `[buyer]`

Back to Hala — still verified from Scene 3.

> **Hala:** *"Quick one — our final 20% will clear next week. Can we book the handover for H-V14?"*
>
> **Ora:** *"Of course, Mrs. Hala — exciting milestone! 🎉 What date and time would suit you and Mr. Ahmed?"*
>
> **Hala:** *"Three weeks from today, around 10am if possible."*
>
> **Ora:** *"Noted — three weeks from today, 10:00–12:00 window, both of you attending. I've placed the appointment on hold pending two items: final payment clearance and your service-charge settlement. Your oqood is already issued and your IDs are on file. The moment the final payment lands, our handover team will confirm the slot and arrange the keys ceremony. I won't promise a final time until those two items clear — but you're nearly there."*

**Panel:** Omar (`project_manager`) sees the conditional booking with the readiness checklist.

---

### Scene 8 — Contractor requests a hot works permit `[contractor]`

Actor: **Faisal** at BuildRight site office.

> **Faisal:** *"Hi, this is BuildRight site office."*
>
> **Ora:** *"Hi! I'm Ora, the assistant for Bayn. Who am I speaking to, and what's the best email and mobile so I can match you to your contractor account?"*
>
> **Faisal:** *"Faisal, contractor@ora-demo.com, +971 50 600 0044."*
>
> **Ora:** *"Got you, Faisal — BuildRight Contracting LLC, on file. How can I help today?"*
>
> **Faisal:** *"Need a hot works permit. Welding on Tower B Level 14 north shaft, day after tomorrow, 7am to 5pm. Fire watch is assigned, 4 extinguishers on standby."*
>
> **Ora:** *"Perfect — you've covered the safety basics, that helps. I've drafted the hot works permit: Tower B Level 14, welding + grinding, 07:00–17:00, fire watch assigned, 4 extinguishers, fire blanket over the cable trays below. Mariam in HSE will review and sign off; once approved you'll get the permit number and a printable copy. Anything else for the same crew that day?"*

**Panel:** Mariam (`hse_officer`) approves → PTW reference issued.

---

### Scene 9 — Work-at-height for façade cleaning `[contractor2]`

Actor: **Maya** at SkyLine Access.

> **Maya:** *"Hi Ora, this is Maya from SkyLine Access — ops@... sorry, contractor2@ora-demo.com."*
>
> **Ora:** *"Hi Maya — SkyLine Access, on file 👋. What can I do for you today?"*
>
> **Maya:** *"Work-at-height permit. Rope access, Tower A Levels 18 to 24, façade cleaning ahead of inspection. Three days starting Monday, crew of four."*
>
> **Ora:** *"Got it. Before I send to HSE — quick rescue plan summary? They'll want it on the permit."*
>
> **Maya:** *"Standby rescue team on Level 18 with full descent kit, twin lanyards on all crew, backup line per operator."*
>
> **Ora:** *"Perfect, Maya — noted. Permit drafted: rope access, Levels 18–24, 4 crew, full body harness + twin lanyard + backup line, rescue team Level 18, three days from Monday. With Mariam in HSE for approval."*

---

### Scene 10 — Material delivery + lift booking `[contractor]`

Faisal again, same conversation as Scene 8.

> **Faisal:** *"One more — tomorrow I need the Tower B hoist all day. Finishing materials going up to Levels 12–14, around 1.8 tonnes total."*
>
> **Ora:** *"Sure thing. The hoist is free 06:00–18:00 tomorrow on Tower B — booking it for you. I'll also flag site security so the trucks at the gate are routed straight through. Material lift, 1.8 tonnes, with floor protection — I'll add that note for the lift operator. Plate numbers for the trucks?"*
>
> **Faisal:** *"DXB-44218 and AUH-22119."*
>
> **Ora:** *"Logged. Rashid at the gate will be expecting them."*

**Panel:** Rashid (`site_security`) sees the booking on his gate dashboard with both plates.

---

### Scene 11 — Consultant requests Civil Defence inspection `[consultant]`

Actor: **Ziad**.

> **Ziad:** *"Good afternoon"*
>
> **Ora:** *"Good afternoon! I'm Ora. May I have your name, please?"*
>
> **Ziad:** *"Ziad, from Project Consultancy."*
>
> **Ora:** *"Welcome, Ziad 👋. How can I help today?"*
>
> **Ziad:** *"Please schedule the Dubai Civil Defence inspection for Tower A handover readiness — 12 days from now, 9am to 1pm. Scope is fire alarm, sprinklers and smoke control."*
>
> **Ora:** *"Of course — to log this against your consultant record, could I have the email on file?"*
>
> **Ziad:** *"consultant@ora-demo.com."*
>
> **Ora:** *"Got it. Inspection request drafted: Civil Defence, Tower A common areas, 12 days from today 09:00–13:00, scope fire alarm + sprinkler flow + smoke control. Omar in projects has been notified to coordinate site access and inspector escort. I'll confirm the slot once Civil Defence comes back."*

---

### Scene 12 — Vendor access for landscaping `[vendor2]`

Actor: **Dina** at Greenleaf Landscaping.

> **Dina:** *"Hi"*
>
> **Ora:** *"Hi! I'm Ora. May I have your name, please?"*
>
> **Dina:** *"Dina, from Greenleaf Landscaping."*
>
> **Ora:** *"Welcome, Dina 🌿 — how can I help today?"*
>
> **Dina:** *"I need monthly garden maintenance access — starting next week and running for the next month. Crew lead is Rajan, vehicle DXB-77881."*
>
> **Ora:** *"Of course — to log this against your vendor account with us, could I have the email on file?"*
>
> **Dina:** *"vendor2@ora-demo.com."*
>
> **Ora:** *"Got it, Greenleaf is on file. Monthly access drafted: from next week through the following month, lead Rajan, vehicle DXB-77881. Community ops will approve and you'll get a reusable QR pass at the gate — same one for the whole period, no daily check-in needed. I'll let you know the moment it's live."*

---

### Scene 13 — Tenant move-in (post-handover roadmap teaser) `[tenant1]`

Actor: **Hassan** — *"once Bayn opens."* This scene shows the same agent will own move-in flows the day units hand over.

> **Hassan:** *"Hi there"*
>
> **Ora:** *"Hi! I'm Ora, your assistant at Bayn. May I have your name?"*
>
> **Hassan:** *"Hassan Al Ameri, tenant1@ora-demo.com."*
>
> **Ora:** *"Welcome, Mr. Hassan! Congratulations on the keys 🎉 — how can I help?"*
>
> **Hassan:** *"I want to schedule my move-in next Friday with Al Maha Movers — 4-person crew, truck DXB-12345."*
>
> **Ora:** *"Of course. Move-in for unit B-103 next Friday with Al Maha Movers, 4 crew, truck DXB-12345 — noted. One quick thing: could you have the moving company send across their certificate of insurance? Standard requirement, helps the gate clear them straight away. Once that's in, I'll confirm the slot."*

**Panel:** community ops sees the conditional move-in approval pending COI upload.

---

### Scene 14 — Sensitive escalation / handoff `[buyer3]`

Actor: **Mariam** in Arabic. This shows the **safety guardrail** — Ora doesn't try to be a hero on cancellation/refund.

> **Mariam:** *"مرحبا"*
>
> **Ora:** *"مرحبا بكِ في بَيْن! أنا أورا. كيف أناديكِ، وما هو إيميلكِ المسجل؟"*
>
> **Mariam:** *"مريم السويدي — buyer3@ora-demo.com."*
>
> **Ora:** *"أهلاً بكِ أستاذة مريم — سعدت بتواصلكِ. تفضلي، كيف أقدر أخدمكِ؟"*
>
> **Mariam:** *"أبغى ألغي الحجز وأسترد المبلغ."*
>
> **Ora:** *"أفهمكِ، ومعليش أنّو وصلتِ لهذي المرحلة. لأن هذا الطلب يتعلّق بعقدكِ، السياسة عندنا توجب توثيق هويتكِ أولاً. راح يوصلكِ رمز من 6 أرقام على b\*\*y\*r3@ora-demo.com."*
>
> **Mariam:** *"913 274."*
>
> **Ora:** *"تم التحقق ✅. لأنّ الإلغاء والاسترداد قرار حسّاس، راح أنقلكِ مباشرة لفاتن في فريق التمويل، وهي بتتواصل معكِ خلال 24 ساعة لمراجعة حسابكِ وشرح الخيارات. إذا في أي شيء تحبين أخبريها به مسبقاً، اكتبيه هنا وأنا أرفقه للملف."*

**Showcase point for management:** Ora never auto-actioned the refund. Identity verified, escalation logged, human owns the decision.

---

### Scene 15 — Show the management dashboard

Open `/ora-panel`:

- **Tickets queue** filtered by `requestType` — show the off-plan permits stack.
- **Pending approvals** — show HSE and project_manager queues populated from the scenes above.
- **Audit log** — show every action Ora took with actor = "ai" / persona email.
- **Conversations** — open Hala's, show the persisted memory and OTP verification.

---

### Tone cheat-sheet — phrases Ora actually uses

Hand this to the actors so they know what to expect back. These are the building blocks the system prompt encourages.

**Greetings (discovery)**
- *"Hi! I'm Ora, the in-house assistant at ORA Developers — may I have your name?"*
- *"Good morning! I'm Ora. May I have your name, please?"*
- *"وعليكم السلام، أهلاً بك في بَيْن! أنا أورا — كيف أناديك؟"*

**Open invitation (after name, before knowing relationship)**
- *"Lovely to meet you, {name}. How can I help today?"*
- *"Nice to meet you, {name} — what brings you to ORA today?"*
- *"تشرفت أستاذ {name} — تفضل، كيف أقدر أخدمك؟"*

**Asking for email when the user has claimed an existing relationship**
- *"Of course — to pull up your account, may I have the email you registered with us?"*
- *"Got it. Could I have your company name and the email on file?"* (broker / vendor)

**Recognition (only AFTER an email lookup confirms the account)**
- *"Welcome back, Mr. Khalid 👋"* / *"Welcome back, Mrs. Hala — always a pleasure 🌟"*
- *"يا هلا أستاذ خالد — تشرفت."*
- *"I see a couple of accounts under that name — could you share your unit number so I open the right one?"*

**Open invitation**
- *"What brings you in today?"* / *"How can I help?"* / *"تفضل، كيف أقدر أخدمك؟"*

**Verification framed as care**
- *"Of course — quick thing first. For your security, our policy asks me to verify it's really you. I'm sending a 6-digit code to b\*\*y\*r@ora-demo.com — takes a second."*
- *"Absolutely, happy to help. Because this involves your contract, I'll just verify it's really you — code on its way."*
- *"أفهمك، ولأن الطلب يخص عقدك، السياسة عندنا توجب توثيق هويتك أولاً. راح يوصلك رمز على إيميلك."*

**Confirming an action**
- *"Perfect, you're verified ✅."* / *"Got it, noted on your file."*
- *"On its way."* / *"Logged."* / *"تم بكل سرور."*

**Holding back (no unilateral promises)**
- *"I've placed it on hold pending X. The moment that's in, the team will confirm and reach out."*
- *"For this one I'd rather hand you to a human — Faten in finance will be in touch within 24 hours."*

**Closings**
- *"Anything else I can take care of while we're at it?"*
- *"تحت أمرك في أي وقت."* / *"Always here if you need me."*

> **What Ora avoids:** menus, button lists, "I am an AI assistant", asking the same question twice, mixing English and Arabic in the same reply, confirming dates/times unilaterally, joking about money or contracts.

---

## 5. Sample questions per role (idea bank)

Use these if you want to improvise beyond the scripted scenes.

### Investor / prospective buyer
- "What's the expected handover for Bayn Marina Tower B?"
- "What's the payment plan? 60/40 or other options?"
- "What schools are within 10 minutes of Bayn Hills?"
- "What's the average rental yield in the area?"
- "Send me the masterplan PDF."
- "Book a site visit for Saturday morning."

### Broker
- "Do you have any 2BR sea-view available under 3M?"
- "Register me as a broker with Crown Properties."
- "Hold unit M-0801 for 24 hours for my client."
- "What's the commission structure?"

### Booked client
- "What's my next payment milestone?"
- "Status of my oqood?"
- "Need a mortgage NOC for ENBD."
- "Can I add my spouse to the SPA?"
- "Send latest construction photos for my unit."
- "Book my handover appointment."
- "I have snags from my walkthrough."

### Contractor / vendor
- "Hot works permit for welding tomorrow."
- "Work-at-height permit for facade cleaning."
- "Book the Tower B hoist for material lift."
- "Schedule a material delivery at site gate 2."
- "Vendor access for monthly garden maintenance."

### Consultant / engineer
- "Schedule the civil defence inspection."
- "DEWA witness test for Tower A common areas."
- "Snag clearance walkthrough for unit H-V14."

### Future tenant (post-handover demo)
- "I want to move in next Friday."
- "Issue a gate pass for my family for the weekend."
- "AC isn't cooling — emergency."
- "Book the padel court for Saturday at 6pm."
- "Issue an access card for my mother."

---

## 6. Resetting between runs

```bash
# Wipes only @ora-demo.com persona data and reseeds
npm run db:seed:demo
```

`resetDemo()` cleans everything tagged with the `@ora-demo.com` domain or the
`[DEMO]` / `TKT-DEMO-` / `ORA-APT-DEMO-` prefixes. Real users and real tickets
are untouched.

---

## 7. Talking points for management

- **One brain, one memory** — Ora handles sales, ops, HSE, security and finance flows from a single conversation. No second system, no retraining when Bayn hands over.
- **Human-in-the-loop where it matters** — every approval-gated permit (NOC, hot works, work-at-height, handover, mortgage NOC, vendor access, move-in) routes to the right human role. Ora does the intake; humans decide.
- **Bilingual** — every persona can chat in EN or AR; replies match the user's language.
- **Safe by default** — personal / payment / sensitive answers require OTP-verified identity. Refunds and contract changes always go to a human.
- **Audit-ready** — every action is logged with actor, diff and timestamp.
- **Same agent grows with the project** — today's site permits and brochure requests, tomorrow's move-ins and amenity bookings.
