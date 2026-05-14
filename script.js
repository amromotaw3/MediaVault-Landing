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

  // --- Smart Latest Release Fetcher ---
  const repoOwner = 'amromotaw3';
  const repoName = 'MediaVault-Landing';

  async function updateDownloadLinks() {
    try {
      const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`);
      const data = await response.json();

      if (data.assets && data.assets.length > 0) {
        const winAsset = data.assets.find(asset => asset.name.endsWith('.exe'));
        const androidAsset = data.assets.find(asset => asset.name.endsWith('.apk'));

        if (winAsset) {
          document.getElementById('download-win').href = winAsset.browser_download_url;
        }
        if (androidAsset) {
          document.getElementById('download-android').href = androidAsset.browser_download_url;
        }
        
        // تحديث نص الإصدار في الصفحة إذا وجد
        const versionBadge = document.getElementById('app-version-badge');
        if (versionBadge && data.tag_name) {
          versionBadge.innerText = `MEDIAVAULT ${data.tag_name.toUpperCase()} IS HERE`;
        }
      }
    } catch (error) {
      console.error('Error fetching latest release:', error);
    }
  }

  updateDownloadLinks();

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
