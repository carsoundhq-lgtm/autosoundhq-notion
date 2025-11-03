// scripts/aiContent.js
// Adds useful tutorial content + returns structured data for FAQ & HowTo schema.

function presetFor(title = "") {
  const lower = title.toLowerCase();

  // Amplifier tuning preset
  if (/(amp|amplifier).*tune|tuning|gain|lpf|hpf/.test(lower)) {
    const howtoSteps = [
      { name: "Set a flat baseline", text: "On the head unit, turn EQ, Loudness, and Bass Boost OFF. Set volume to ~75% of max." },
      { name: "Set the gain correctly", text: "Start with the gain at minimum. Play a clean 40 Hz tone (subs) or 1 kHz tone (speakers). Raise gain until just before distortion, then back down slightly." },
      { name: "Configure filters", text: "Set LPF for subwoofers to 80–100 Hz. Set HPF for door speakers to 80–120 Hz." },
      { name: "Use bass boost sparingly", text: "Keep Bass Boost at 0; add a little only if needed after setting gain." },
      { name: "Fine-tune by ear", text: "Listen to varied music and adjust in small steps over several days." }
    ];
    const faqItems = [
      { q: "Do I need a multimeter to tune an amp?", a: "It helps but isn't required. Your ears are fine for basic tuning; a meter or oscilloscope improves precision." },
      { q: "What volume should I tune at?", a: "About 70–80% of your head unit’s maximum volume provides a good reference." },
      { q: "Why use HPF on door speakers?", a: "HPF protects mids from low-frequency energy, improving clarity and reducing distortion." }
    ];
    const pdf = "/assets/guides/amp-tuning.pdf";

    const html = `
<section class="guide-content">
  <p class="muted small"><em>This tutorial is auto-generated for convenience. Always follow your equipment’s manual and verify settings by ear.</em></p>

  <h2>How to Tune a Car Amplifier</h2>
  <ol>
    <li><strong>Flat baseline:</strong> Turn off EQ/Loudness/Bass Boost. Volume ~75% of max.</li>
    <li><strong>Gain:</strong> Start at minimum; play a 40 Hz (subs) or 1 kHz (speakers) tone; raise until just before distortion, then back down slightly.</li>
    <li><strong>Filters:</strong> LPF = 80–100 Hz for subs; HPF = 80–120 Hz for door speakers.</li>
    <li><strong>Bass Boost:</strong> Keep at 0; add a little only if needed after gain is set.</li>
    <li><strong>Fine-tune:</strong> Listen to several tracks and adjust in small steps over a few days.</li>
  </ol>

  <p><a class="btn ghost" href="${pdf}" target="_blank" rel="noopener">Download PDF Guide</a></p>

  <h3>Common Mistakes</h3>
  <ul>
    <li>Using the <em>gain</em> as a volume knob (it isn’t).</li>
    <li>Maxing bass boost, which causes clipping and heat.</li>
    <li>Running speakers without an HPF, leading to muddy sound and damage.</li>
    <li>Poor ground (painted metal) causing noise/whine.</li>
  </ul>

  <h3>FAQ</h3>
  <p><strong>Do I need a multimeter?</strong> It's helpful but not required—your ears work for basic tuning.</p>
  <p><strong>What volume should I tune at?</strong> Roughly 70–80% of maximum head unit volume.</p>
  <p><strong>Why set HPF/LPF?</strong> Proper filtering protects speakers and keeps bass tight.</p>
</section>`;

    return { html, faqItems, howtoSteps };
  }

  // Fallback generic preset
  const howtoSteps = [
    { name: "Prepare", text: "Gather tools and read the manufacturer’s instructions." },
    { name: "Configure basics", text: "Apply recommended baseline settings." },
    { name: "Optimize", text: "Adjust settings to your goals and vehicle." },
    { name: "Test & refine", text: "Use several tracks and refine over a few days." }
  ];
  const faqItems = [
    { q: "How long does this take?", a: "Usually 20–40 minutes the first time." },
    { q: "Any safety notes?", a: "Avoid clipping, check wiring/fuses, and ensure good ventilation around amplifiers." }
  ];
  const html = `
<section class="guide-content">
  <p class="muted small"><em>This tutorial is auto-generated for convenience. Always follow your equipment’s manual.</em></p>

  <h2>Step-by-Step Guide</h2>
  <ol>
    <li><strong>Prepare:</strong> Gather tools and read the manual.</li>
    <li><strong>Configure basics:</strong> Apply recommended baseline settings.</li>
    <li><strong>Optimize:</strong> Adjust to your goals and vehicle.</li>
    <li><strong>Test & refine:</strong> Use several tracks and refine over a few days.</li>
  </ol>

  <h3>Common Mistakes</h3>
  <ul>
    <li>Skipping tuning and only installing hardware.</li>
    <li>Random settings with no baseline.</li>
    <li>Not testing across multiple genres/volumes.</li>
  </ul>

  <h3>FAQ</h3>
  <p><strong>How long does this take?</strong> Usually 20–40 minutes the first time.</p>
  <p><strong>Any safety notes?</strong> Avoid clipping, check wiring/fuses, keep ventilation around amps.</p>
</section>`;

  return { html, faqItems, howtoSteps };
}

export function generateGuideContent(title) {
  return presetFor(title);
}
