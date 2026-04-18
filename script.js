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
  // ─── Auto-Versioning Logic ────────────────────────────────────────────────
  const setupAutoVersioning = async () => {
    try {
      // Fetch package.json from the root
      const response = await fetch('./package.json');
      if (!response.ok) return;
      const data = await response.json();
      const version = data.version;

      // Update Badge
      const badge = document.getElementById('app-version-badge');
      if (badge) {
        badge.textContent = `MEDIAVAULT V${version} IS HERE`;
      }

      // Update Download Links
      const downloadLinks = document.querySelectorAll('.download-link');
      downloadLinks.forEach(link => {
        const platform = link.id === 'download-win' ? 'Windows' : '';
        if (platform === 'Windows') {
          link.href = `https://github.com/amromotaw3/MediaVault-Setup/releases/download/v${version}/MediaVault-Setup-${version}.exe`;
        }
      });
      
      console.log(`[Auto-Version] Site updated to v${version}`);
    } catch (err) {
      console.error('[Auto-Version] Failed to fetch version:', err);
    }
  };

  setupAutoVersioning();
});
