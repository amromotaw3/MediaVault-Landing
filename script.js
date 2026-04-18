document.addEventListener('DOMContentLoaded', () => {
  // Intersection Observer for scroll animations
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // Only animate once
      }
    });
  }, observerOptions);

  // Observe all feature cards
  const cards = document.querySelectorAll('.feature-card');
  cards.forEach(card => observer.observe(card));

  // Dynamic parallax effect for hero mockup
  const heroImg = document.querySelector('.hero-img-wrap');
  if (heroImg && window.innerWidth > 1024) {
    window.addEventListener('mousemove', (e) => {
      const mouseX = (e.clientX / window.innerWidth - 0.5) * 20;
      const mouseY = (e.clientY / window.innerHeight - 0.5) * 20;
      
      heroImg.style.transform = `perspective(1000px) rotateY(${ -15 + mouseX}deg) rotateX(${ 5 - mouseY}deg)`;
    });
  }

  // Smooth scroll for anchors
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      document.querySelector(targetId).scrollIntoView({
        behavior: 'smooth'
      });
    });
  });
  // ─── Auto-Versioning Logic (GitHub API) ───────────────────────────────────
  const setupAutoVersioning = async () => {
    try {
      // Fetch the latest release info from GitHub
      const repo = 'amromotaw3/MediaVault-Setup';
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (!response.ok) return;
      const release = await response.json();
      
      // tag_name is usually "v8.5.1", we can extract the number or use it as is
      const version = release.tag_name.replace(/^v/, ''); 

      // 1. Update Version Badge
      const badge = document.getElementById('app-version-badge');
      if (badge) {
        badge.textContent = `MEDIAVAULT V${version} IS HERE`;
      }

      // 2. Update Download Links (Search for the EXE in assets)
      const winAsset = release.assets.find(a => a.name.endsWith('.exe') && !a.name.includes('Setup'));
      const setupAsset = release.assets.find(a => a.name.endsWith('.exe') && a.name.includes('Setup'));
      
      const downloadLinks = document.querySelectorAll('.download-link');
      downloadLinks.forEach(link => {
        // Default fallback if assets aren't found specifically
        let downloadUrl = `https://github.com/${repo}/releases/download/v${version}/MediaVault-Setup-${version}.exe`;
        
        // Use the actual direct URL from GitHub Assets if available
        if (setupAsset) downloadUrl = setupAsset.browser_download_url;
        
        link.href = downloadUrl;
      });
      
      console.log(`[Auto-Version] Site synced with GitHub Release v${version}`);
    } catch (err) {
      console.error('[Auto-Version] Failed to sync with GitHub:', err);
    }
  };

  setupAutoVersioning();
});
