type DebounceOptions = {
  delayMs: number;
  leading?: boolean;
  trailing?: boolean;
  onSuppressed?: () => void;
};

const sourceLanguage = document.querySelector('#sourceLanguage') as HTMLSelectElement;
const targetLanguage = document.querySelector('#targetLanguage') as HTMLSelectElement;
const delayInput = document.querySelector('#delayMs') as HTMLInputElement;
const leadingToggle = document.querySelector('#leadingToggle') as HTMLInputElement;
const trailingToggle = document.querySelector('#trailingToggle') as HTMLInputElement;
const sourceText = document.querySelector('#sourceText') as HTMLTextAreaElement;
const translationOutput = document.querySelector('#translationOutput') as HTMLDivElement;
const eventLog = document.querySelector('#eventLog') as HTMLUListElement;
const disposeButton = document.querySelector('#disposeButton') as HTMLButtonElement;
const resetButton = document.querySelector('#resetButton') as HTMLButtonElement;
const totalCallsEl = document.querySelector('#totalCalls') as HTMLElement;
const executionsEl = document.querySelector('#executions') as HTMLElement;
const httpRequestsEl = document.querySelector('#httpRequests') as HTMLElement;
const suppressedCallsEl = document.querySelector('#suppressedCalls') as HTMLElement;

type DebouncedTranslator = ((value: string) => void) & {
  dispose: () => void;
};

class Debounce {
  private readonly fn: (value: string) => void;
  private readonly delayMs: number;
  private readonly leading: boolean;
  private readonly trailing: boolean;
  private readonly onSuppressed?: () => void;
  private timerId: number | null = null;
  private lastArgs: string | null = null;
  private disposed = false;
  private leadingExecuted = false;
  private trailingPending = false;

  constructor(fn: (value: string) => void, options: DebounceOptions) {
    this.fn = fn;
    this.delayMs = options.delayMs;
    this.leading = !!options.leading;
    this.trailing = options.trailing !== false;
    this.onSuppressed = options.onSuppressed;
  }

  public wrap(): DebouncedTranslator {
    const handler = ((value: string): void => {
      if (this.disposed) {
        return;
      }

      this.lastArgs = value;

      if (this.leading && !this.trailing) {
        if (!this.leadingExecuted) {
          this.leadingExecuted = true;
          this.timerId = window.setTimeout(() => {
            this.leadingExecuted = false;
            this.timerId = null;
            this.lastArgs = null;
          }, this.delayMs);
          this.fn(value);
          return;
        }

        this.onSuppressed?.();
        return;
      }

      if (!this.leading && this.trailing) {
        if (this.timerId === null) {
          this.timerId = window.setTimeout(() => {
            if (this.lastArgs !== null) {
              const pending = this.lastArgs;
              this.lastArgs = null;
              this.fn(pending);
            }
            this.timerId = null;
          }, this.delayMs);
        } else {
          this.onSuppressed?.();
        }
        return;
      }

      if (this.leading && this.trailing) {
        if (!this.leadingExecuted) {
          this.leadingExecuted = true;
          this.trailingPending = false;
          this.timerId = window.setTimeout(() => {
            const shouldRunTrailing = this.trailingPending && this.lastArgs !== null;
            this.leadingExecuted = false;
            this.trailingPending = false;
            this.timerId = null;

            if (shouldRunTrailing) {
              const pending = this.lastArgs;
              this.lastArgs = null;
              this.fn(pending ?? value);
            }
          }, this.delayMs);
          this.fn(value);
          return;
        }

        this.trailingPending = true;
        this.onSuppressed?.();
        return;
      }

      this.onSuppressed?.();
    }) as DebouncedTranslator;

    handler.dispose = () => {
      this.dispose();
    };

    return handler;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.lastArgs = null;
    this.leadingExecuted = false;
    this.trailingPending = false;
  }
}

function debounce(fn: (value: string) => void, options: DebounceOptions): DebouncedTranslator {
  return new Debounce(fn, options).wrap();
}

let eventCounter = 0;
let totalCalls = 0;
let executions = 0;
let httpRequests = 0;
let suppressedCalls = 0;
let activeDebounce: DebouncedTranslator | undefined;

function addLog(type: string, label: string, value?: string): void {
  const item = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<strong>[${time}] ${type}</strong> ${label}${value ? `: ${value}` : ''}`;
  if (type === 'ERROR') {
    item.classList.add('error');
  }
  eventLog.prepend(item);
}

function updateStats(): void {
  suppressedCalls = Math.max(0, totalCalls - executions);
  totalCallsEl.textContent = String(totalCalls);
  executionsEl.textContent = String(executions);
  httpRequestsEl.textContent = String(httpRequests);
  suppressedCallsEl.textContent = String(suppressedCalls);
}

function recreateDebounce(): void {
  const delayMs = Number(delayInput.value) || 500;
  const options: DebounceOptions = {
    delayMs,
    leading: leadingToggle.checked,
    trailing: trailingToggle.checked,
    onSuppressed: () => {
      addLog('SUPPRESSED', 'Suppressed', sourceText.value);
    },
  };

  if (activeDebounce) {
    activeDebounce.dispose();
  }

  activeDebounce = debounce((value: string) => {
    const kind = options.leading && !options.trailing
      ? 'LEADING EXECUTION'
      : options.leading && options.trailing
        ? 'TRAILING EXECUTION'
        : 'EXECUTION';
    executions += 1;
    addLog('EXECUTION', kind, value);
    updateStats();

    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: value,
        sourceLanguage: sourceLanguage.value,
        targetLanguage: targetLanguage.value,
      }),
    })
      .then(async (response) => {
        httpRequests += 1;
        addLog('HTTP_REQUEST', 'Request sent', value);
        updateStats();

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? 'Translation failed');
        }

        translationOutput.textContent = payload.translation;
        addLog('RESPONSE', 'Translation received', payload.translation);
      })
      .catch((error) => {
        translationOutput.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
        addLog('ERROR', 'Translation error', error instanceof Error ? error.message : 'Unknown error');
      });
  }, options);
}

function onInput(): void {
  const currentValue = sourceText.value;
  totalCalls += 1;
  const callId = ++eventCounter;
  addLog('CALL', `CALL #${callId}`, currentValue);

  if (!activeDebounce) {
    recreateDebounce();
  }

  activeDebounce?.(currentValue);
  updateStats();
}

sourceText.addEventListener('input', () => {
  onInput();
});

[sourceLanguage, targetLanguage, delayInput, leadingToggle, trailingToggle].forEach((element) => {
  element.addEventListener('change', () => {
    recreateDebounce();
  });
});

delayInput.addEventListener('input', () => {
  recreateDebounce();
});

disposeButton.addEventListener('click', () => {
  if (activeDebounce) {
    activeDebounce.dispose();
    addLog('ERROR', 'Dispose called', 'pending execution cancelled');
  }
});

resetButton.addEventListener('click', () => {
  sourceText.value = '';
  translationOutput.textContent = 'Waiting for input...';
  eventLog.innerHTML = '';
  eventCounter = 0;
  totalCalls = 0;
  executions = 0;
  httpRequests = 0;
  suppressedCalls = 0;
  updateStats();
  recreateDebounce();
});

recreateDebounce();
updateStats();
