gsap.registerPlugin(ScrollTrigger);

// --- Loader helper ---
function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    setTimeout(() => loader.remove(), 650);
}

// --- Priority image loader ---
// Loads a batch of images and resolves when ALL in the batch are ready
function loadImageBatch(indices, getPath) {
    return Promise.all(
        indices.map(i => new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img); // don't block on broken images
            img.src = getPath(i);
        }))
    );
}

document.addEventListener('DOMContentLoaded', async () => {

    // --- Initial Hero Text Reveal (On Load) ---
    gsap.to('#initial-hero-text', {
        y: 0, opacity: 1, duration: 1.5, ease: 'power3.out', delay: 0.2
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
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        render();
    });

    const frameCount = 84;
    const PRIORITY_COUNT = 10; // Load these first before showing the page

    const currentFrame = index =>
        `/images/herosection/Mee_hero_section_${String(index).padStart(5, '0')}.png`;

    // Allocate the full images array upfront (slots filled as batches load)
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

    // STEP 1: Load priority frames (0–9) — block until ready
    const priorityIndices = Array.from({ length: PRIORITY_COUNT }, (_, i) => i);
    const priorityImgs = await loadImageBatch(priorityIndices, currentFrame);
    priorityImgs.forEach((img, i) => { images[i] = img; });

    // Page is ready — hide loader and init GSAP
    render();
    hideLoader();
    initGSAP();

    // STEP 2: Load remaining frames in background batches (no blocking)
    const BATCH_SIZE = 10;
    const remaining = Array.from({ length: frameCount - PRIORITY_COUNT }, (_, i) => i + PRIORITY_COUNT);

    async function loadRemainingInBatches() {
        for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
            const batch = remaining.slice(i, i + BATCH_SIZE);
            const loaded = await loadImageBatch(batch, currentFrame);
            loaded.forEach((img, j) => { images[batch[j]] = img; });
            // Yield to the browser between batches so scroll stays smooth
            await new Promise(r => setTimeout(r, 50));
        }
    }

    loadRemainingInBatches(); // fire and forget

    // --- GSAP init (runs immediately after priority frames) ---
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
        gsap.set('#singer-cta-left',  { x: -100, opacity: 0 });
        gsap.set('#singer-cta-right', { x:  100, opacity: 0 });

        // Phase 1: English Text
        timeline.to('#initial-hero-scroll', { scale: 1.2, opacity: 0, duration: 1.5, ease: 'power2.in' }, 0);

        // Phase 2: Artist CTA Boxes
        timeline.to('#singer-cta-left',  { opacity: 1, x: 0, duration: 2.0, ease: 'power3.out' }, 1.5);
        timeline.to('#singer-cta-right', { opacity: 1, x: 0, duration: 2.0, ease: 'power3.out' }, 2.0);
        timeline.to('#singer-cta-left',  { opacity: 0, x: -100, duration: 1.2, ease: 'power2.in' }, 4.5);
        timeline.to('#singer-cta-right', { opacity: 0, x:  100, duration: 1.2, ease: 'power2.in' }, 4.8);

        // Phase 3: Malayalam Text
        timeline.to('#malayalam-hero-text', { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' }, 5.5);
    }

    // --- Scroll animations (runs after loader hides) ---
    function initScrollAnimations() {
        document.querySelectorAll('.gs-fade-up').forEach(el => {
            gsap.from(el, {
                scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
                y: 60, opacity: 0, duration: 0.8, ease: 'power2.out'
            });
        });

        document.querySelectorAll('.gs-scale-up').forEach(el => {
            gsap.from(el, {
                scrollTrigger: { trigger: el, start: 'top 80%', toggleActions: 'play none none reverse' },
                scale: 0.9, opacity: 0, duration: 1, ease: 'expo.out'
            });
        });

        document.querySelectorAll('.gs-fade-left').forEach(el => {
            gsap.from(el, {
                scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
                x: 50, opacity: 0, duration: 1, ease: 'power3.out'
            });
        });

        document.querySelectorAll('.gs-fade-right').forEach(el => {
            gsap.from(el, {
                scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none reverse' },
                x: -50, opacity: 0, duration: 1, ease: 'power3.out'
            });
        });
    }

    initScrollAnimations();
});