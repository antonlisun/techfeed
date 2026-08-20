/* Site configuration. Edit this file, not app.js.
 *
 * Feed sources live in ../sources.json — they're fetched at build time, so adding a
 * source there is all that's needed; this file covers what the browser controls. */

window.FEED_CONFIG = {

  /* Where the data comes from -------------------------------------------------
   * Leave `repo` blank on GitHub Pages (it republishes on every commit, so the
   * same-origin file is always current). On Netlify, data-only commits are set to
   * skip deploys, so fill this in and the page reads the fresh feed.json straight
   * from GitHub whenever the served copy has gone stale. */
  repo: { owner: "", name: "", branch: "main" },
  localData: "data/feed.json",
  staleAfter: 45 * 60 * 1000,

  /* Subjects -------------------------------------------------------------------
   * Each becomes a chip and a filter. `test` is matched against the headline,
   * summary and the feed's own category tags. Add a line to add a subject. */
  topics: [
    { label: "Ransomware", test: /ransom|extort|lockbit|blackcat|alphv|cl0p|akira/i },
    { label: "Vulnerabilities", test: /vulnerab|CVE-|zero.day|0-day|exploit|patch|flaw|\bRCE\b/i },
    { label: "Data breaches", test: /breach|leak|exposed|stolen data|\brecords\b|hacked/i },
    { label: "Malware", test: /malware|trojan|infostealer|botnet|backdoor|rootkit|spyware|worm/i },
    { label: "Phishing", test: /phish|smish|social engineer|business email|\bBEC\b|scam|impersonat/i },
    { label: "Supply chain", test: /supply chain|npm\b|pypi|crate|dependen|third.party|vendor compromise/i },
    { label: "AI", test: /\bAI\b|artificial intelligence|\bLLM\b|\bGPT\b|chatbot|deepfake|prompt inject|machine learning/i },
    { label: "Critical infrastructure", test: /critical infrastructure|\bICS\b|\bSCADA\b|\bOT\b|water|power grid|healthcare|hospital/i },
    { label: "Identity", test: /password|credential|\bMFA\b|authenticat|identity|session token|single sign|\bSSO\b/i },
    { label: "Cloud & network", test: /cloud|\bAWS\b|Azure|\bVPN\b|firewall|router|kubernetes|\bSaaS\b/i },
    { label: "Microsoft", test: /microsoft|windows|azure|office 365|exchange|entra|sharepoint/i },
    { label: "Apple", test: /\bapple\b|\bios\b|macos|iphone|safari/i },
    { label: "Google", test: /google|android|chrome\b|gmail/i },
    { label: "Policy & law", test: /CISA|\bFBI\b|\bNIST\b|regulat|\blaw\b|court|sanction|governmen|senat|\bEU\b|GDPR|indict|charges/i },
  ],

  /* Time windows offered in the filter panel. */
  timeRanges: [
    { label: "Any time", hours: 0 },
    { label: "24 hours", hours: 24 },
    { label: "3 days", hours: 72 },
    { label: "Week", hours: 168 },
  ],

  /* Rendering ---------------------------------------------------------------- */
  batch: 9,              // cards added per scroll step
  perSheet: 3,           // cards grouped into one white sheet
  autoRefresh: 5 * 60 * 1000,
};
