gsap.registerPlugin(ScrollTrigger);

// --- Loader helper ---
function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    setTimeout(() => loader.remove(), 650);
}

// --- Optimized image loader with progressive enhancement ---
function loadImageBatch(indices, getPath) {
    return Promise.all(
        indices.map(i => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img);
            img.src = getPath(i);
        }))
    );
}

document.addEventListener('DOMContentLoaded', async () => {

    // --- Initial Hero Text Reveal (Instant - no delay) ---
    gsap.to('#initial-hero-text', {
        y: 0, opacity: 1, duration: 0.8, ease: 'power3.out'
    });

    // --- Canvas Scroll Sequence ---
    const canvas = document.getElementById('hero-canvas');
    if (!canvas) {
        hideLoader();
        initScrollAnimations();
        return;
    }

    const context = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            render();
        }, 150);
    });

    const frameCount = 84;
    const PRIORITY_COUNT = 3; // Load only 3 frames initially (reduced from 10)

    const currentFrame = index =>
        `/images/herosection/Mee_hero_section_${String(index).padStart(5, '0')}.webp`;

    const images = new Array(frameCount).fill(null);
    const animState = { frame: 0 };

    function render() {
        const img = images[animState.frame];
        if (!img) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const hRatio = canvas.width / img.width;
        const vRatio = canvas.height / img.height;
        const ratio = Math.max(hRatio, vRatio);
        const cx = (canvas.width - img.width * ratio) / 2;
        const cy = (canvas.height - img.height * ratio) / 2;
        context.drawImage(img, 0, 0, img.width, img.height, cx, cy, img.width * ratio, img.height * ratio);
    }

    // STEP 1: Load ONLY first 3 frames - super fast initial load
    const priorityIndices = [0, 1, 2];
    const priorityImgs = await loadImageBatch(priorityIndices, currentFrame);
    priorityImgs.forEach((img, i) => { images[priorityIndices[i]] = img; });

    // Page is ready - hide loader immediately
    render();
    hideLoader();
    initGSAP();
    initScrollAnimations();

    // STEP 2: Aggressively load remaining frames in larger batches
    const BATCH_SIZE = 20; // Increased from 10 for faster loading
    const remaining = Array.from({ length: frameCount - PRIORITY_COUNT }, (_, i) => i + PRIORITY_COUNT);

    async function loadRemainingInBatches() {
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
            const batch = remaining.slice(i, i + BATCH_SIZE);
            const loaded = await loadImageBatch(batch, currentFrame);
            loaded.forEach((img, j) => { images[batch[j]] = img; });
            // Minimal delay to keep UI responsive
            await new Promise(r => setTimeout(r, 10));
        }
    }

    loadRemainingInBatches();

    // --- GSAP init ---
    function initGSAP() {
        const timeline = gsap.timeline({
            scrollTrigger: {
                trigger: '#hero-sequence',
                pin: true,
                scrub: 1,
                start: 'top top',
                end: '+=4000',
                invalidateOnRefresh: true
            }
        });

        const masterDuration = 8;

        timeline.to(animState, {
            frame: frameCount - 1,
            snap: 'frame',
            ease: 'none',
            onUpdate: render,
            duration: masterDuration
        }, 0);

        gsap.set('#malayalam-hero-text', { scale: 1.3 });
        gsap.set('#singer-cta-left', { x: -100, opacity: 0 });
        gsap.set('#singer-cta-right', { x: 100, opacity: 0 });

        // Phase 1: English Text
        timeline.to('#initial-hero-scroll', { scale: 1.2, opacity: 0, duration: 1.5, ease: 'power2.in' }, 0);

        // Phase 2: Artist CTA Boxes
        timeline.to('#singer-cta-left', { opacity: 1, x: 0, duration: 2.0, ease: 'power3.out' }, 1.5);
        timeline.to('#singer-cta-right', { opacity: 1, x: 0, duration: 2.0, ease: 'power3.out' }, 2.0);
        timeline.to('#singer-cta-left', { opacity: 0, x: -100, duration: 1.2, ease: 'power2.in' }, 4.5);
        timeline.to('#singer-cta-right', { opacity: 0, x: 100, duration: 1.2, ease: 'power2.in' }, 4.8);

        // Phase 3: Malayalam Text
        timeline.to('#malayalam-hero-text', { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' }, 5.5);
    }

    // --- Scroll animations ---
    function initScrollAnimations() {
        // Use Intersection Observer for better performance
        const animateOnScroll = (selector, animation) => {
            const elements = document.querySelectorAll(selector);
            if (elements.length === 0) return;

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        gsap.from(entry.target, animation);
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -15% 0px' });

            elements.forEach(el => observer.observe(el));
        };

        animateOnScroll('.gs-fade-up', {
            y: 60, opacity: 0, duration: 0.8, ease: 'power2.out'
        });

        animateOnScroll('.gs-scale-up', {
            scale: 0.9, opacity: 0, duration: 1, ease: 'expo.out'
        });

        animateOnScroll('.gs-fade-left', {
            x: 50, opacity: 0, duration: 1, ease: 'power3.out'
        });

        animateOnScroll('.gs-fade-right', {
            x: -50, opacity: 0, duration: 1, ease: 'power3.out'
        });
    }
});