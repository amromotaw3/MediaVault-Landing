document.addEventListener('DOMContentLoaded', () => {
  // --- Feature Card Animation on Scroll ---
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  document.querySelectorAll('.feature-card').forEach(card => {
    observer.observe(card);
  });

  // --- Sticky Navigation Effect ---
  const mainNav = document.querySelector('.main-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      mainNav.style.padding = '10px 0';
      mainNav.style.background = 'rgba(7, 7, 10, 0.95)';
    } else {
      mainNav.style.padding = '0';
      mainNav.style.background = 'rgba(7, 7, 10, 0.7)';
    }
  });

  // --- Smooth Anchor Scrolling (Fallback) ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        window.scrollTo({
          top: target.offsetTop - 80, // Offset for sticky nav
          behavior: 'smooth'
        });
      }
    });
  });
});
