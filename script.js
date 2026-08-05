// ------------------------------------------------------
// PEAKORA — Assistant Modal + Conversation Flow
// ------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // --------------------
  // DOM ELEMENTS
  // --------------------
  const assistantButton = document.getElementById("assistantButton");
  const assistantModalOverlay = document.getElementById("assistantModal");
  const assistantMessages = document.getElementById("assistantMessages");
  const assistantInput = document.getElementById("assistantInput");
  const assistantSend = document.getElementById("assistantSend");
  const assistantClose = document.getElementById("assistantClose");

  // --------------------
  // STATE
  // --------------------
  let conversationStage = 1; // 1: ask name, 2: get name, 3: first intent, 4: micro-guidance, 5: deep support + option, 6+: dynamic Q&A
  let userName = "";
  let currentIntent = null;
  let typingTimeout = null;

  // --------------------
  // PEAKORA KNOWLEDGE BASE (DATABASE)
  // --------------------
  const KNOWLEDGE_BASE = {
    anxiety: {
      firstStep: (name) =>
        `Thank you for sharing that with me, ${name}. When anxiety rises, it can feel like your mind is racing ahead of your body. What part of your day feels most uncertain right now?`,
      secondStep: (name) =>
        `I hear you clearly, ${name}. Let us ground your nervous system together right now. Take a soft breath in through your nose for 4 seconds, hold gently for 2 seconds, and exhale slowly for 6 seconds. Notice how your chest softens.`,
      thirdStep: (name) =>
        `You are doing remarkably well just by slowing down. Anxiety tries to persuade us that everything requires immediate action, but taking this quiet pause is an act of real strength.`,
      followUpReplies: [
        "Guide me through a focus reset",
        "Give me a 2-minute breathing exercise",
        "How does Peakora help with stress?"
      ]
    },
    overwhelm: {
      firstStep: (name) =>
        `I understand, ${name}. Carrying multiple demands at once builds quiet exhaustion. What is the single heaviest task on your mind at this moment?`,
      secondStep: (name) =>
        `When everything feels urgent, nothing can be processed deeply. Let us unburden your focus. Choose just one item you can set aside until tomorrow without consequence.`,
      thirdStep: (name) =>
        `Remember, ${name}, progress is built through single, deliberate steps rather than frantic effort. You do not have to resolve everything today.`,
      followUpReplies: [
        "Help me prioritize",
        "How do I set better boundaries?",
        "Connect me to Peakora Assistant"
      ]
    },
    focus: {
      firstStep: (name) =>
        `Mind wandering and brain fog happen when your energy is fragmented, ${name}. Are you feeling physically tired, or mentally distracted by too many open loops?`,
      secondStep: (name) =>
        `Let us restore your concentration gently. Pick a single task and commit to just 5 minutes of quiet effort. Allow yourself to stop when the timer ends if you wish.`,
      thirdStep: (name) =>
        `Small focus blocks protect your cognitive energy. Once momentum begins, clarity naturally follows.`,
      followUpReplies: [
        "Tell me about Solfeggio soundscapes",
        "Give me a 5-minute task strategy",
        "What is Peakora Plus?"
      ]
    },
    sleep: {
      firstStep: (name) =>
        `Rest is essential, ${name}. Is your mind holding onto unfinished thoughts from today, or does your body feel physically tense as you try to unwind?`,
      secondStep: (name) =>
        `Your brain requires a clear transition signal between active work and peaceful rest. Lower your screen brightness, write down lingering thoughts on paper, and allow your shoulders to drop away from your ears.`,
      thirdStep: (name) =>
        `Giving yourself permission to rest is not unproductivity—it is how you restore your vitality for tomorrow.`,
      followUpReplies: [
        "Evening wind-down routine",
        "How to stop night overthinking",
        "Connect me to Peakora Assistant"
      ]
    },
    routine: {
      firstStep: (name) =>
        `Routines feel burdensome when we demand perfection, ${name}. Which part of your day feels most out of sync—your morning start or your evening close?`,
      secondStep: (name) =>
        `Sustainable habits thrive on low friction. Instead of overhauling your day, protect one tiny 2-minute anchor—such as drinking water mindfully upon waking or taking three conscious breaths before dinner.`,
      thirdStep: (name) =>
        `Consistency is built through kindness to yourself, not strict pressure. Protect one anchor today.`,
      followUpReplies: [
        "How to build micro-habits",
        "Morning focus routine",
        "What features does Peakora offer?"
      ]
    },
    pricing: {
      firstStep: (name) =>
        `Peakora offers both a free foundational wellness experience and Peakora Plus for deeper personal support. Would you like to know more about our plan options?`,
      secondStep: (name) =>
        `Peakora Plus includes full access to our interactive AI Assistant dashboard, custom Solfeggio sound frequency generators, unlimited emotional logging, and personalized daily routines.`,
      thirdStep: (name) =>
        `All subscriptions are secured via Paddle billing, with a simple cancel-anytime policy directly from your member profile.`,
      followUpReplies: [
        "Connect me to Peakora Assistant",
        "Explore Peakora Plus",
        "Ask about routines"
      ]
    },
    general: {
      firstStep: (name) =>
        `Thank you for reaching out, ${name}. Taking a moment to check in with yourself is a meaningful step. Tell me a bit more about what you would like to work through today.`,
      secondStep: (name) =>
        `I am listening. Whatever you are navigating—stress, routine changes, or simply seeking clarity—we can take it one gentle step at a time.`,
      thirdStep: (name) =>
        `You are fully capable of navigating this. I am here whenever you need a calm sounding board.`,
      followUpReplies: [
        "I feel overwhelmed",
        "I need a breath reset",
        "What is Peakora?"
      ]
    }
  };

  // --------------------
  // TYPING INDICATOR
  // --------------------
  function showTypingIndicator() {
    let existing = assistantMessages.querySelector(".assistant-typing");
    if (existing) return;

    const typing = document.createElement("div");
    typing.classList.add("assistant-message", "assistant-typing");
    typing.innerHTML = `
      <div class="typing-indicator-wrapper">
        <span class="typing-text">Peakora is reflecting</span>
        <span class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>
    `;
    assistantMessages.appendChild(typing);
    scrollSmooth();
  }

  function hideTypingIndicator() {
    const typing = assistantMessages.querySelector(".assistant-typing");
    if (typing) typing.remove();
  }

  // --------------------
  // SCROLL
  // --------------------
  function scrollSmooth() {
    if (!assistantMessages) return;
    assistantMessages.scrollTo({
      top: assistantMessages.scrollHeight,
      behavior: "smooth",
    });
  }

  // --------------------
  // MESSAGE HELPERS
  // --------------------
  function addAssistantMessage(text) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("assistant-message", "assistant");

    const p = document.createElement("p");
    p.textContent = text;
    wrapper.appendChild(p);

    assistantMessages.appendChild(wrapper);
    scrollSmooth();
  }

  function addUserMessage(text) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("assistant-message", "user");

    const p = document.createElement("p");
    p.textContent = text;
    wrapper.appendChild(p);

    assistantMessages.appendChild(wrapper);
    scrollSmooth();
  }

  function addAssistantMessageWithDelay(text, delay = 600) {
    showTypingIndicator();
    if (typingTimeout) clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
      hideTypingIndicator();
      addAssistantMessage(text);
    }, delay);
  }

  // --------------------
  // SMART REPLIES
  // --------------------
  function clearSmartReplies() {
    const existing = assistantMessages.querySelectorAll(".assistant-smart-replies");
    existing.forEach((el) => el.remove());
  }

  function createSmartReplyButton(label, value) {
    const btn = document.createElement("button");
    btn.classList.add("assistant-smart-reply");
    btn.textContent = label;

    btn.addEventListener("click", () => {
      clearSmartReplies();
      handleSend(value, true);
    });

    return btn;
  }

  function showSmartRepliesForName() {
    setTimeout(() => {
      clearSmartReplies();

      const container = document.createElement("div");
      container.classList.add("assistant-smart-replies");

      container.appendChild(createSmartReplyButton("I prefer not to share my name", "I prefer not to share my name"));
      container.appendChild(createSmartReplyButton("Call me friend", "Call me friend"));
      container.appendChild(createSmartReplyButton("I will share it later", "I will share it later"));

      assistantMessages.appendChild(container);
      scrollSmooth();
    }, 650);
  }

  function showSmartRepliesForCategory(category) {
    setTimeout(() => {
      clearSmartReplies();

      const container = document.createElement("div");
      container.classList.add("assistant-smart-replies");

      const replies = KNOWLEDGE_BASE[category]?.followUpReplies || [
        "I feel overwhelmed",
        "My routine is off",
        "Connect me to Peakora Assistant"
      ];

      replies.forEach((reply) => {
        container.appendChild(createSmartReplyButton(reply, reply));
      });

      assistantMessages.appendChild(container);
      scrollSmooth();
    }, 650);
  }

  // --------------------
  // MODAL OPEN/CLOSE
  // --------------------
  function openAssistant() {
    assistantModalOverlay.classList.add("open");

    if (!assistantMessages || assistantMessages.children.length === 0) {
      startConversation();
    }

    assistantInput.focus();
  }

  function closeAssistant() {
    assistantModalOverlay.classList.remove("open");
  }

  // --------------------
  // CONVERSATION START
  // --------------------
  function startConversation() {
    conversationStage = 1;
    userName = "";
    currentIntent = null;
    clearSmartReplies();
    assistantMessages.innerHTML = "";

    addAssistantMessageWithDelay("Welcome to Peakora.");
    setTimeout(() => {
      addAssistantMessageWithDelay("I am your companion for emotional balance and focus. What name or nickname would you like me to call you?");
      showSmartRepliesForName();
    }, 700);
  }

  // ------------------------------------------------------
  // INTENT DETECTION DATABASE LOOKUP
  // ------------------------------------------------------
  function detectIntentCategory(text) {
    const t = text.toLowerCase();

    if (t.includes("anxious") || t.includes("anxiety") || t.includes("panic") || t.includes("worried") || t.includes("racing") || t.includes("fear") || t.includes("nervous")) {
      return "anxiety";
    }
    if (t.includes("overwhelm") || t.includes("too much") || t.includes("stress") || t.includes("burnt") || t.includes("burnout") || t.includes("exhausted") || t.includes("drained")) {
      return "overwhelm";
    }
    if (t.includes("focus") || t.includes("concentrate") || t.includes("distract") || t.includes("procrastinat") || t.includes("fog") || t.includes("stuck")) {
      return "focus";
    }
    if (t.includes("sleep") || t.includes("insomnia") || t.includes("rest") || t.includes("night") || t.includes("bed") || t.includes("tired")) {
      return "sleep";
    }
    if (t.includes("routine") || t.includes("schedule") || t.includes("habit") || t.includes("structure") || t.includes("morning") || t.includes("evening")) {
      return "routine";
    }
    if (t.includes("price") || t.includes("cost") || t.includes("plus") || t.includes("crown") || t.includes("subscription") || t.includes("paddle") || t.includes("member")) {
      return "pricing";
    }

    return "general";
  }

  // ------------------------------------------------------
  // CONVERSATION ENGINE — HANDLE USER INPUT
  // ------------------------------------------------------
  function handleSend(forcedText = null, fromSmartReply = false) {
    const text = forcedText || assistantInput.value.trim();
    if (!text) return;

    if (!fromSmartReply) {
      addUserMessage(text);
    }

    assistantInput.value = "";
    clearSmartReplies();

    // --------------------
    // STAGE 1 — ASK NAME
    // --------------------
    if (conversationStage === 1) {
      conversationStage = 2;
    }

    // --------------------
    // STAGE 2 — PROCESS NAME
    // --------------------
    if (conversationStage === 2) {
      const lower = text.toLowerCase();

      if (fromSmartReply && (lower.includes("prefer not to share") || lower.includes("call me friend") || lower.includes("share it later"))) {
        userName = "friend";
      } else if (looksLikeName(text)) {
        userName = text.trim();
      } else {
        userName = "friend";
      }

      addAssistantMessageWithDelay(`Thank you, ${userName}. What is on your mind today?`);
      showSmartRepliesForCategory("general");
      conversationStage = 3;
      return;
    }

    // --------------------
    // STAGE 3 — FIRST KNOWLEDGE LOOKUP
    // --------------------
    if (conversationStage === 3) {
      currentIntent = detectIntentCategory(text);
      const categoryData = KNOWLEDGE_BASE[currentIntent] || KNOWLEDGE_BASE.general;

      addAssistantMessageWithDelay(categoryData.firstStep(userName));
      showSmartRepliesForCategory(currentIntent);
      conversationStage = 4;
      return;
    }

    // --------------------
    // STAGE 4 — SECOND MICRO-GUIDANCE
    // --------------------
    if (conversationStage === 4) {
      const categoryData = KNOWLEDGE_BASE[currentIntent] || KNOWLEDGE_BASE.general;

      addAssistantMessageWithDelay(categoryData.secondStep(userName));
      showSmartRepliesForCategory(currentIntent);
      conversationStage = 5;
      return;
    }

    // --------------------
    // STAGE 5 — DEEP SUPPORT + ASSISTANT REDIRECT OFFER
    // --------------------
    if (conversationStage === 5) {
      const categoryData = KNOWLEDGE_BASE[currentIntent] || KNOWLEDGE_BASE.general;

      addAssistantMessageWithDelay(categoryData.thirdStep(userName));

      setTimeout(() => {
        addRedirectBlock();
        conversationStage = 6;
      }, 1100);

      return;
    }

    // --------------------
    // STAGE 6+ — DYNAMIC MULTI-TURN KNOWLEDGE RESPONSE
    // --------------------
    if (conversationStage >= 6) {
      const newCategory = detectIntentCategory(text);
      const categoryData = KNOWLEDGE_BASE[newCategory] || KNOWLEDGE_BASE.general;

      addAssistantMessageWithDelay(
        `I hear you, ${userName}. ${categoryData.secondStep(userName)}`
      );

      setTimeout(() => {
        showSmartRepliesForCategory(newCategory);
      }, 800);
      return;
    }
  }

  // ------------------------------------------------------
  // TEXT VALIDATION HELPERS
  // ------------------------------------------------------
  function looksLikeName(text) {
    if (!text) return false;
    const cleaned = text.toLowerCase().trim();

    const bad = [
      "why", "no", "not now", "later", "skip", "none",
      "i don't want to", "i dont want to", "idk", "don't know",
      "dont know", "no name", "anonymous"
    ];

    if (bad.includes(cleaned)) return false;
    return /^[a-zA-Z\s]{2,25}$/.test(text.trim());
  }

  // ------------------------------------------------------
  // REDIRECT BLOCK — OFFER FULL PEAKORA ASSISTANT
  // ------------------------------------------------------
  function addRedirectBlock() {
    showTypingIndicator();

    setTimeout(() => {
      hideTypingIndicator();

      const wrapper = document.createElement("div");
      wrapper.classList.add("assistant-message");

      const textEl = document.createElement("p");
      textEl.style.margin = "0 0 10px 0";
      textEl.textContent =
        "For a complete personalized daily plan and deep emotional tools, you can launch the Peakora Assistant dashboard anytime.";

      const btn = document.createElement("button");
      btn.textContent = "Open Peakora Assistant Workspace";
      btn.style.padding = "12px 20px";
      btn.style.background = "linear-gradient(135deg, #e07a5f 0%, #f4a261 100%)";
      btn.style.color = "#ffffff";
      btn.style.border = "none";
      btn.style.borderRadius = "999px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "14px";
      btn.style.fontWeight = "700";
      btn.style.boxShadow = "0 4px 16px rgba(224, 122, 95, 0.35)";

      btn.addEventListener("click", () => {
        window.location.href = "assistant.html";
      });

      wrapper.appendChild(textEl);
      wrapper.appendChild(btn);
      assistantMessages.appendChild(wrapper);
      scrollSmooth();
    }, 850);
  }

  // ------------------------------------------------------
  // PADDLE BILLING SDK INITIALIZATION
  // ------------------------------------------------------
  function initPaddleSDK() {
    const clientToken = window.PADDLE_CLIENT_TOKEN || localStorage.getItem("paddle_client_token") || "";
    const environment = localStorage.getItem("paddle_env") || "sandbox";

    if (window.Paddle && typeof window.Paddle.Initialize === "function") {
      try {
        if (environment) {
          window.Paddle.Environment.set(environment);
        }
        if (clientToken) {
          window.Paddle.Initialize({
            token: clientToken,
            eventCallback: function (evt) {
              if (evt && (evt.name === "checkout.completed" || evt.name === "payment.succeeded")) {
                console.log("[Paddle] Payment transaction completed successfully:", evt);
                localStorage.setItem("peakora_plus_member", "true");
                localStorage.setItem("peakora_subscription_status", "Active");
              }
            }
          });
          console.log(`[Paddle SDK] Initialized successfully in ${environment} mode.`);
        } else {
          console.warn("[Paddle SDK] Ready for configuration: set client token via PADDLE_CLIENT_TOKEN or localStorage.");
        }
      } catch (err) {
        console.warn("[Paddle SDK] Configuration note:", err);
      }
    }
  }

  // Expose initialization function globally
  window.initPaddleSDK = initPaddleSDK;

  // Initialize Paddle SDK
  initPaddleSDK();

  // ------------------------------------------------------
  // EVENT LISTENERS & KEYBOARD SUPPORT
  // ------------------------------------------------------

  // Floating button → open modal
  assistantButton?.addEventListener("click", () => {
    openAssistant();
  });

  // Close button → close modal
  assistantClose?.addEventListener("click", () => {
    closeAssistant();
  });

  // Click outside modal closes it
  assistantModalOverlay?.addEventListener("click", (e) => {
    if (e.target === assistantModalOverlay) {
      closeAssistant();
    }
  });

  // Send button → trigger send
  assistantSend?.addEventListener("click", () => {
    handleSend();
  });

  // Enter key triggers send when input is focused
  assistantInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Escape key closes the Peakora assistant modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && assistantModalOverlay?.classList.contains("open")) {
      closeAssistant();
    }
  });

  // Mobile navigation hamburger toggle handler
  const mobileMenuToggle = document.getElementById("mobileMenuToggle");
  const mainNav = document.getElementById("mainNav");

  if (mobileMenuToggle && mainNav) {
    mobileMenuToggle.addEventListener("click", () => {
      mobileMenuToggle.classList.toggle("open");
      mainNav.classList.toggle("open");
    });

    // Auto close mobile drawer when any link is clicked
    const navLinks = mainNav.querySelectorAll(".nav-link");
    navLinks.forEach(link => {
      link.addEventListener("click", () => {
        mobileMenuToggle.classList.remove("open");
        mainNav.classList.remove("open");
      });
    });
  }

  // ------------------------------------------------------
  // STANDARDIZED TOAST NOTIFICATION SYSTEM
  // ------------------------------------------------------
  function showToast(message, type = "info", duration = 3200) {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast-item toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'warning') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f4a261" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="0.01"></line></svg>`;
    }

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-text">${message}</div>
      <button class="toast-close" onclick="this.parentElement.remove()" aria-label="Close">&times;</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("fade-out");
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, duration);
  }

  window.showToast = showToast;

}); // <-- END OF DOMContentLoaded WRAPPER
