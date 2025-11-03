// scripts/aiContent.js
// Lightweight rule-based content generator for AutoSoundHQ.
// Adds useful tutorial text so Google indexes your pages faster.

export function generateGuideContent(title) {
  const lower = (title || "").toLowerCase();

  // ------- presets for common topics -------
  const presets = [];

  // Amplifier tuning
  presets.push({
    match: /(amp|amplifier).*tune|tuning|gain|lpf|hpf/,
    pdf: "/assets/guides/amp-tuning.pdf",
    steps: `
<h2>How to Tune a Car Amplifier</h2>
<ol>
  <li><strong>Flat baseline:</strong> On the head unit set EQ/Loudness/Bass Boost off. Volume ~75% of max.</li>
  <li><strong>Gain:</strong> Start at minimum; play a clean track or 40Hz tone (subs) / 1kHz (speakers); turn gain up until just before distortion, then back slightly.</li>
  <li><strong>Filters:</strong> LPF for subs at 80–100Hz. HPF for door speakers at 80–120Hz.</li>
  <li><strong>Bass boost:</strong> Keep at 0; add a little only if needed after gain is set.</li>
  <li><strong>Fine-tune:</strong> Test several songs and adjust in small steps over a few days.</li>
</ol>`,
    mistakes: `
<h3>Common Mistakes</h3>
<ul>
  <li>Using the <em>gain</em> as a volume knob (it isn’t).</li>
  <li>Running speakers with no HPF—leads to muddy sound and damage.</li>
  <li>Max bass boost—causes clipping and heat.</li>
  <li>Poor ground (painted metal) causing noise/whine.</li>
</ul>`,
    faq: `
<h3>FAQ</h3>
<p><strong>Do I need special tools?</strong> Your ears are enough; a multimeter or oscilloscope helps but is optional.</p>
<p><strong>What volume should I tune at?</strong> About 70–80% of your head unit’s max volume.</p>`
  });

  // ------- choose a preset if one matches -------
  const preset = presets.find(p => p.match.test(lower));

  // ------- build sections -------
  const steps = preset?.steps || `
<h2>Step-by-Step Guide</h2>
<ol>
  <li>Prepare tools and a clean workspace.</li>
  <li>Follow the manufacturer’s basic setup.</li>
  <li>Optimize settings for your vehicle and goals.</li>
  <li>Test with several tracks and fine-tune.</li>
</ol>`;

  const mistakes = preset?.mistakes || `
<h3>Common Mistakes</h3>
<ul>
  <li>Skipping tuning and only installing hardware.</li>
  <li>Random settings with no baseline.</li>
  <li>Not testing across multiple genres/volumes.</li>
</ul>`;

  const faq = preset?.faq || `
<h3>FAQ</h3>
<p><strong>How long does this take?</strong> Usually 20–40 minutes the first time.</p>
<p><strong>Any safety notes?</strong> Avoid clipping, check wiring/fuses, keep ventilation around amps.</p>`;

  const pdfHTML = preset?.pdf
    ? `<p><a class="btn ghost" href="${preset.pdf}" target="_blank" rel="noopener">Download PDF Guide</a></p>`
    : "";

  return `
<section class="guide-content">
  <p class="muted small"><em>This tutorial is auto-generated for convenience. Always follow your equipment’s manual and verify settings by ear.</em></p>
  ${steps}
  ${pdfHTML}
  ${mistakes}
  ${faq}
</section>`;
}
