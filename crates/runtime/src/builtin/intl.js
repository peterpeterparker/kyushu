import { intl_dtf_resolve_fields, intl_validate_timezone, intl_collator_compare, intl_segment } from "__wasm_rquickjs_builtin/intl_native";

const MONTH_NAMES_LONG = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];
const MONTH_NAMES_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];
const MONTH_NAMES_NARROW = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const WEEKDAY_NAMES_LONG = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];
const WEEKDAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES_NARROW = ["S", "M", "T", "W", "T", "F", "S"];

const ERA_NAMES_LONG = { positive: "Anno Domini", negative: "Before Christ" };
const ERA_NAMES_SHORT = { positive: "AD", negative: "BC" };
const ERA_NAMES_NARROW = { positive: "A", negative: "B" };

const CURRENCY_SYMBOLS = {
    USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥",
    KRW: "₩", INR: "₹", RUB: "₽", BRL: "R$", ZAR: "R",
    TRY: "₺", PLN: "zł", THB: "฿", IDR: "Rp", MYR: "RM",
    PHP: "₱", VND: "₫", SEK: "kr", NOK: "kr", DKK: "kr",
    CHF: "CHF", CAD: "CA$", AUD: "A$", NZD: "NZ$", MXN: "MX$",
    SGD: "S$", HKD: "HK$", TWD: "NT$", ARS: "ARS", CLP: "CLP",
    COP: "COP", PEN: "PEN", ILS: "₪", AED: "AED", SAR: "SAR",
    EGP: "EGP", NGN: "₦", KES: "KES", UAH: "₴", CZK: "Kč",
    HUF: "Ft", RON: "lei", BGN: "лв",
};

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function toTimestamp(date) {
    if (date === undefined) return Date.now();
    if (typeof date === "number") return date;
    if (date instanceof Date) return date.getTime();
    throw new TypeError("Invalid date");
}

// ─── DateTimeFormat ────────────────────────────────────────────────────────────

function resolveDateStyleOptions(dateStyle) {
    switch (dateStyle) {
        case "full":
            return { weekday: "long", year: "numeric", month: "long", day: "numeric" };
        case "long":
            return { year: "numeric", month: "long", day: "numeric" };
        case "medium":
            return { year: "numeric", month: "short", day: "numeric" };
        case "short":
            return { year: "2-digit", month: "numeric", day: "numeric" };
        default:
            return {};
    }
}

function resolveTimeStyleOptions(timeStyle) {
    switch (timeStyle) {
        case "full":
            return { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "long" };
        case "long":
            return { hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" };
        case "medium":
            return { hour: "numeric", minute: "2-digit", second: "2-digit" };
        case "short":
            return { hour: "numeric", minute: "2-digit" };
        default:
            return {};
    }
}

function formatMonthValue(month, style) {
    switch (style) {
        case "2-digit": return pad2(month);
        case "long": return MONTH_NAMES_LONG[month - 1];
        case "short": return MONTH_NAMES_SHORT[month - 1];
        case "narrow": return MONTH_NAMES_NARROW[month - 1];
        case "numeric":
        default:
            return String(month);
    }
}

function formatWeekdayValue(chronoWeekday, style) {
    // chrono weekday: 1=Mon..7=Sun; arrays: 0=Sun,1=Mon..6=Sat
    const dow = chronoWeekday === 7 ? 0 : chronoWeekday;
    switch (style) {
        case "long": return WEEKDAY_NAMES_LONG[dow];
        case "short": return WEEKDAY_NAMES_SHORT[dow];
        case "narrow": return WEEKDAY_NAMES_NARROW[dow];
        default: return WEEKDAY_NAMES_LONG[dow];
    }
}

function formatEraValue(year, style) {
    const key = year > 0 ? "positive" : "negative";
    switch (style) {
        case "long": return ERA_NAMES_LONG[key];
        case "short": return ERA_NAMES_SHORT[key];
        case "narrow": return ERA_NAMES_NARROW[key];
        default: return ERA_NAMES_SHORT[key];
    }
}

function convertHour(hour24, hour12Flag, hourCycle) {
    if (hourCycle === "h12" || (hour12Flag === true && !hourCycle)) {
        const period = hour24 < 12 ? "AM" : "PM";
        let h = hour24 % 12;
        if (h === 0) h = 12;
        return { hour: h, dayPeriod: period };
    }
    if (hourCycle === "h11") {
        const period = hour24 < 12 ? "AM" : "PM";
        const h = hour24 % 12;
        return { hour: h, dayPeriod: period };
    }
    if (hourCycle === "h24") {
        const h = hour24 === 0 ? 24 : hour24;
        return { hour: h, dayPeriod: null };
    }
    // h23 or default (no hour12)
    if (hour12Flag === false || hourCycle === "h23" || (!hour12Flag && !hourCycle)) {
        return { hour: hour24, dayPeriod: null };
    }
    // Default: hour12 = true for en-US
    const period = hour24 < 12 ? "AM" : "PM";
    let h = hour24 % 12;
    if (h === 0) h = 12;
    return { hour: h, dayPeriod: period };
}

class DateTimeFormatImpl {
    #timeZone;
    #hour12;
    #hourCycle;
    #dateStyle;
    #timeStyle;
    #fieldOpts;

    constructor(locales, options) {
        const opts = options || {};
        const tz = opts.timeZone || "UTC";
        if (!intl_validate_timezone(tz)) {
            throw new RangeError("Invalid time zone specified: " + tz);
        }
        this.#timeZone = tz;
        this.#hour12 = opts.hour12;
        this.#hourCycle = opts.hourCycle;
        this.#dateStyle = opts.dateStyle;
        this.#timeStyle = opts.timeStyle;

        if (this.#dateStyle || this.#timeStyle) {
            this.#fieldOpts = {
                ...resolveDateStyleOptions(this.#dateStyle),
                ...resolveTimeStyleOptions(this.#timeStyle),
            };
        } else {
            this.#fieldOpts = {};
            for (const k of ["year", "month", "day", "hour", "minute", "second",
                "weekday", "era", "timeZoneName"]) {
                if (opts[k] !== undefined) this.#fieldOpts[k] = opts[k];
            }
            // If no date/time fields specified at all, default to date-only
            if (Object.keys(this.#fieldOpts).length === 0) {
                this.#fieldOpts = { year: "numeric", month: "numeric", day: "numeric" };
            }
        }

        // Determine hour12 default for en-US when hour is present
        if (this.#fieldOpts.hour !== undefined && this.#hour12 === undefined && !this.#hourCycle) {
            this.#hour12 = true;
        }
    }

    #resolve(date) {
        const ts = toTimestamp(date);
        const [year, month, day, hour, minute, second, weekday, utcOffsetMinutes, error] =
            intl_dtf_resolve_fields(ts, this.#timeZone);
        if (error !== undefined) {
            throw new RangeError(error);
        }
        return { year, month, day, hour, minute, second, weekday, utcOffsetMinutes };
    }

    formatToParts(date) {
        const r = this.#resolve(date);
        const fo = this.#fieldOpts;
        const parts = [];
        let needDateTimeSep = false;
        const hasDateFields = fo.weekday || fo.era || fo.year || fo.month || fo.day;
        const hasTimeFields = fo.hour || fo.minute || fo.second;

        // Weekday
        if (fo.weekday) {
            parts.push({ type: "weekday", value: formatWeekdayValue(r.weekday, fo.weekday) });
            parts.push({ type: "literal", value: ", " });
        }

        // Month
        if (fo.month) {
            const monthStr = formatMonthValue(r.month, fo.month);
            const isNumericMonth = fo.month === "numeric" || fo.month === "2-digit";

            if (isNumericMonth) {
                // Numeric date: M/D/YYYY
                parts.push({ type: "month", value: monthStr });
                if (fo.day) {
                    parts.push({ type: "literal", value: "/" });
                    const dayStr = fo.day === "2-digit" ? pad2(r.day) : String(r.day);
                    parts.push({ type: "day", value: dayStr });
                }
                if (fo.year) {
                    parts.push({ type: "literal", value: "/" });
                    const yearStr = fo.year === "2-digit"
                        ? String(r.year).slice(-2)
                        : String(r.year);
                    parts.push({ type: "year", value: yearStr });
                }
            } else {
                // Text month: Month D, YYYY
                parts.push({ type: "month", value: monthStr });
                if (fo.day) {
                    parts.push({ type: "literal", value: " " });
                    const dayStr = fo.day === "2-digit" ? pad2(r.day) : String(r.day);
                    parts.push({ type: "day", value: dayStr });
                }
                if (fo.year) {
                    parts.push({ type: "literal", value: ", " });
                    const yearStr = fo.year === "2-digit"
                        ? String(r.year).slice(-2)
                        : String(r.year);
                    parts.push({ type: "year", value: yearStr });
                }
            }
            needDateTimeSep = true;
        } else {
            // No month, but maybe year and/or day
            if (fo.year) {
                const yearStr = fo.year === "2-digit"
                    ? String(r.year).slice(-2)
                    : String(r.year);
                parts.push({ type: "year", value: yearStr });
                needDateTimeSep = true;
            }
            if (fo.day) {
                if (parts.length > 0) parts.push({ type: "literal", value: " " });
                const dayStr = fo.day === "2-digit" ? pad2(r.day) : String(r.day);
                parts.push({ type: "day", value: dayStr });
                needDateTimeSep = true;
            }
        }

        // Era
        if (fo.era) {
            parts.push({ type: "literal", value: " " });
            parts.push({ type: "era", value: formatEraValue(r.year, fo.era) });
        }

        // Separator between date and time
        if (needDateTimeSep && hasTimeFields) {
            parts.push({ type: "literal", value: ", " });
        }

        // Time fields
        if (fo.hour) {
            const { hour, dayPeriod } = convertHour(r.hour, this.#hour12, this.#hourCycle);
            const hourStr = fo.hour === "2-digit" ? pad2(hour) : String(hour);
            parts.push({ type: "hour", value: hourStr });

            if (fo.minute) {
                parts.push({ type: "literal", value: ":" });
                parts.push({ type: "minute", value: pad2(r.minute) });
            }
            if (fo.second) {
                parts.push({ type: "literal", value: ":" });
                parts.push({ type: "second", value: pad2(r.second) });
            }

            if (dayPeriod) {
                parts.push({ type: "literal", value: " " });
                parts.push({ type: "dayPeriod", value: dayPeriod });
            }
        }

        // TimeZoneName
        if (fo.timeZoneName) {
            parts.push({ type: "literal", value: " " });
            const tzDisplay = fo.timeZoneName === "long"
                ? this.#timeZone.replace(/_/g, " ")
                : this.#timeZone;
            parts.push({ type: "timeZoneName", value: tzDisplay });
        }

        return parts;
    }

    format(date) {
        return this.formatToParts(date).map(p => p.value).join("");
    }

    resolvedOptions() {
        const ro = {
            locale: "en-US",
            calendar: "gregory",
            numberingSystem: "latn",
            timeZone: this.#timeZone,
        };
        if (this.#dateStyle) ro.dateStyle = this.#dateStyle;
        if (this.#timeStyle) ro.timeStyle = this.#timeStyle;
        const fo = this.#fieldOpts;
        for (const k of ["year", "month", "day", "hour", "minute", "second",
            "weekday", "era", "timeZoneName"]) {
            if (fo[k] !== undefined) ro[k] = fo[k];
        }
        if (fo.hour !== undefined) {
            if (this.#hourCycle) {
                ro.hourCycle = this.#hourCycle;
                ro.hour12 = this.#hourCycle === "h12" || this.#hourCycle === "h11";
            } else if (this.#hour12 !== undefined) {
                ro.hour12 = this.#hour12;
                ro.hourCycle = this.#hour12 ? "h12" : "h23";
            } else {
                ro.hour12 = true;
                ro.hourCycle = "h12";
            }
        }
        return ro;
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function DateTimeFormat(locales, options) {
    return new DateTimeFormatImpl(locales, options);
}
DateTimeFormat.prototype = DateTimeFormatImpl.prototype;
Object.defineProperty(DateTimeFormat.prototype, "constructor", { value: DateTimeFormat, writable: true, configurable: true });
DateTimeFormat.supportedLocalesOf = DateTimeFormatImpl.supportedLocalesOf;
Object.defineProperty(DateTimeFormatImpl.prototype, Symbol.toStringTag, {
    value: "Intl.DateTimeFormat", writable: false, enumerable: false, configurable: true
});

// ─── NumberFormat ───────────────────────────────────────────────────────────────

function groupIntegerPart(intStr) {
    const parts = [];
    let i = intStr.length;
    while (i > 0) {
        const start = Math.max(0, i - 3);
        parts.unshift(intStr.slice(start, i));
        i = start;
    }
    return parts;
}

function formatDecimalNumber(absVal, minInt, minFrac, maxFrac, useGrouping) {
    let fixed = absVal.toFixed(maxFrac);
    let [intPart, fracPart] = fixed.split(".");

    // minimumIntegerDigits
    while (intPart.length < minInt) {
        intPart = "0" + intPart;
    }

    // Trim trailing zeros down to minimumFractionDigits
    if (fracPart) {
        while (fracPart.length > minFrac && fracPart.endsWith("0")) {
            fracPart = fracPart.slice(0, -1);
        }
    }

    const intGroups = useGrouping ? groupIntegerPart(intPart) : [intPart];

    return { intGroups, fracPart: fracPart || "" };
}

class NumberFormatImpl {
    #style;
    #currency;
    #currencyDisplay;
    #minimumIntegerDigits;
    #minimumFractionDigits;
    #maximumFractionDigits;
    #useGrouping;
    #notation;
    #signDisplay;

    constructor(locales, options) {
        const opts = options || {};
        this.#style = opts.style || "decimal";
        this.#currency = opts.currency;
        this.#currencyDisplay = opts.currencyDisplay || "symbol";
        this.#minimumIntegerDigits = opts.minimumIntegerDigits || 1;
        this.#notation = opts.notation || "standard";
        this.#signDisplay = opts.signDisplay || "auto";

        if (this.#style === "currency" && !this.#currency) {
            throw new TypeError("Currency code is required with currency style");
        }

        if (this.#style === "currency") {
            const isJPY = this.#currency && this.#currency.toUpperCase() === "JPY";
            this.#minimumFractionDigits = opts.minimumFractionDigits !== undefined
                ? opts.minimumFractionDigits
                : (isJPY ? 0 : 2);
            this.#maximumFractionDigits = opts.maximumFractionDigits !== undefined
                ? opts.maximumFractionDigits
                : (isJPY ? 0 : 2);
        } else if (this.#style === "percent") {
            this.#minimumFractionDigits = opts.minimumFractionDigits !== undefined
                ? opts.minimumFractionDigits : 0;
            this.#maximumFractionDigits = opts.maximumFractionDigits !== undefined
                ? opts.maximumFractionDigits : 0;
        } else {
            this.#minimumFractionDigits = opts.minimumFractionDigits !== undefined
                ? opts.minimumFractionDigits : 0;
            this.#maximumFractionDigits = opts.maximumFractionDigits !== undefined
                ? opts.maximumFractionDigits : 3;
        }

        this.#useGrouping = opts.useGrouping !== undefined ? opts.useGrouping : true;
    }

    formatToParts(number) {
        const parts = [];
        let val = Number(number);
        const isNeg = val < 0;
        const showSign = this.#signDisplay === "always" || this.#signDisplay === "exceptZero";

        if (isNeg) {
            parts.push({ type: "minusSign", value: "-" });
            val = -val;
        } else if (showSign && (val > 0 || (this.#signDisplay === "always" && val === 0))) {
            if (this.#signDisplay === "always" || val > 0) {
                parts.push({ type: "plusSign", value: "+" });
            }
        }

        if (this.#style === "percent") {
            val = val * 100;
        }

        const { intGroups, fracPart } = formatDecimalNumber(
            val,
            this.#minimumIntegerDigits,
            this.#minimumFractionDigits,
            this.#maximumFractionDigits,
            this.#useGrouping
        );

        if (this.#style === "currency") {
            const code = this.#currency.toUpperCase();
            let sym;
            if (this.#currencyDisplay === "code") {
                sym = code;
            } else if (this.#currencyDisplay === "name") {
                sym = code;
            } else {
                sym = CURRENCY_SYMBOLS[code] || code;
            }
            parts.push({ type: "currency", value: sym });
        }

        for (let i = 0; i < intGroups.length; i++) {
            if (i > 0) {
                parts.push({ type: "group", value: "," });
            }
            parts.push({ type: "integer", value: intGroups[i] });
        }

        if (fracPart.length > 0) {
            parts.push({ type: "decimal", value: "." });
            parts.push({ type: "fraction", value: fracPart });
        }

        if (this.#style === "percent") {
            parts.push({ type: "percentSign", value: "%" });
        }

        return parts;
    }

    format(number) {
        return this.formatToParts(number).map(p => p.value).join("");
    }

    resolvedOptions() {
        const ro = {
            locale: "en-US",
            numberingSystem: "latn",
            style: this.#style,
            minimumIntegerDigits: this.#minimumIntegerDigits,
            minimumFractionDigits: this.#minimumFractionDigits,
            maximumFractionDigits: this.#maximumFractionDigits,
            useGrouping: this.#useGrouping,
            notation: this.#notation,
            signDisplay: this.#signDisplay,
        };
        if (this.#style === "currency") {
            ro.currency = this.#currency.toUpperCase();
            ro.currencyDisplay = this.#currencyDisplay;
        }
        return ro;
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function NumberFormat(locales, options) {
    return new NumberFormatImpl(locales, options);
}
NumberFormat.prototype = NumberFormatImpl.prototype;
Object.defineProperty(NumberFormat.prototype, "constructor", { value: NumberFormat, writable: true, configurable: true });
NumberFormat.supportedLocalesOf = NumberFormatImpl.supportedLocalesOf;
Object.defineProperty(NumberFormatImpl.prototype, Symbol.toStringTag, {
    value: "Intl.NumberFormat", writable: false, enumerable: false, configurable: true
});

// ─── Collator ──────────────────────────────────────────────────────────────────

class CollatorImpl {
    #sensitivity;
    #numeric;
    #ignorePunctuation;
    #usage;
    #caseFirst;
    #collation;

    constructor(locales, options) {
        const opts = options || {};
        this.#sensitivity = opts.sensitivity || "variant";
        this.#numeric = !!opts.numeric;
        this.#ignorePunctuation = !!opts.ignorePunctuation;
        this.#usage = opts.usage || "sort";
        this.#caseFirst = opts.caseFirst || "false";
        this.#collation = opts.collation || "default";
    }

    compare(a, b) {
        return intl_collator_compare(
            String(a),
            String(b),
            this.#sensitivity,
            this.#numeric,
            this.#ignorePunctuation
        );
    }

    resolvedOptions() {
        return {
            locale: "en-US",
            usage: this.#usage,
            sensitivity: this.#sensitivity,
            ignorePunctuation: this.#ignorePunctuation,
            collation: this.#collation,
            numeric: this.#numeric,
            caseFirst: this.#caseFirst,
        };
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function Collator(locales, options) {
    return new CollatorImpl(locales, options);
}
Collator.prototype = CollatorImpl.prototype;
Object.defineProperty(Collator.prototype, "constructor", { value: Collator, writable: true, configurable: true });
Collator.supportedLocalesOf = CollatorImpl.supportedLocalesOf;
Object.defineProperty(CollatorImpl.prototype, Symbol.toStringTag, {
    value: "Intl.Collator", writable: false, enumerable: false, configurable: true
});

// ─── PluralRules ───────────────────────────────────────────────────────────────

class PluralRulesImpl {
    #type;
    #minimumIntegerDigits;
    #minimumFractionDigits;
    #maximumFractionDigits;

    constructor(locales, options) {
        const opts = options || {};
        this.#type = opts.type || "cardinal";
        this.#minimumIntegerDigits = opts.minimumIntegerDigits || 1;
        this.#minimumFractionDigits = opts.minimumFractionDigits !== undefined
            ? opts.minimumFractionDigits : 0;
        this.#maximumFractionDigits = opts.maximumFractionDigits !== undefined
            ? opts.maximumFractionDigits : 3;
    }

    select(n) {
        const val = Number(n);
        if (this.#type === "ordinal") {
            const abs = Math.abs(val);
            const mod10 = abs % 10;
            const mod100 = abs % 100;
            if (mod10 === 1 && mod100 !== 11) return "one";
            if (mod10 === 2 && mod100 !== 12) return "two";
            if (mod10 === 3 && mod100 !== 13) return "few";
            return "other";
        }
        // cardinal
        return val === 1 ? "one" : "other";
    }

    selectRange(_start, _end) {
        return "other";
    }

    resolvedOptions() {
        return {
            locale: "en-US",
            type: this.#type,
            minimumIntegerDigits: this.#minimumIntegerDigits,
            minimumFractionDigits: this.#minimumFractionDigits,
            maximumFractionDigits: this.#maximumFractionDigits,
            pluralCategories: this.#type === "ordinal"
                ? ["few", "one", "other", "two"]
                : ["one", "other"],
        };
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function PluralRules(locales, options) {
    return new PluralRulesImpl(locales, options);
}
PluralRules.prototype = PluralRulesImpl.prototype;
Object.defineProperty(PluralRules.prototype, "constructor", { value: PluralRules, writable: true, configurable: true });
PluralRules.supportedLocalesOf = PluralRulesImpl.supportedLocalesOf;
Object.defineProperty(PluralRulesImpl.prototype, Symbol.toStringTag, {
    value: "Intl.PluralRules", writable: false, enumerable: false, configurable: true
});

// ─── ListFormat ────────────────────────────────────────────────────────────────

const LIST_PATTERNS = {
    conjunction: {
        long:   { middle: ", ", end: ", and ", pair: " and " },
        short:  { middle: ", ", end: ", & ", pair: " & " },
        narrow: { middle: ", ", end: ", ", pair: ", " },
    },
    disjunction: {
        long:   { middle: ", ", end: ", or ", pair: " or " },
        short:  { middle: ", ", end: ", or ", pair: " or " },
        narrow: { middle: ", ", end: ", or ", pair: " or " },
    },
    unit: {
        long:   { middle: ", ", end: ", ", pair: ", " },
        short:  { middle: ", ", end: ", ", pair: ", " },
        narrow: { middle: " ", end: " ", pair: " " },
    },
};

class ListFormatImpl {
    #type;
    #style;
    #patterns;

    constructor(locales, options) {
        const opts = options || {};
        this.#type = opts.type || "conjunction";
        this.#style = opts.style || "long";

        if (!["conjunction", "disjunction", "unit"].includes(this.#type)) {
            throw new RangeError("Invalid type: " + this.#type);
        }
        if (!["long", "short", "narrow"].includes(this.#style)) {
            throw new RangeError("Invalid style: " + this.#style);
        }

        this.#patterns = LIST_PATTERNS[this.#type][this.#style];
    }

    format(list) {
        const items = Array.from(list).map(item => {
            if (typeof item !== "string" && typeof item !== "number" && typeof item !== "bigint" && typeof item !== "boolean") {
                if (item === undefined || item === null) {
                    throw new TypeError("Invalid list item");
                }
            }
            return String(item);
        });
        return this.formatToParts(items).map(p => p.value).join("");
    }

    formatToParts(list) {
        const items = Array.from(list).map(item => String(item));
        const parts = [];

        if (items.length === 0) return parts;
        if (items.length === 1) {
            parts.push({ type: "element", value: items[0] });
            return parts;
        }
        if (items.length === 2) {
            parts.push({ type: "element", value: items[0] });
            parts.push({ type: "literal", value: this.#patterns.pair });
            parts.push({ type: "element", value: items[1] });
            return parts;
        }

        // 3+ items
        parts.push({ type: "element", value: items[0] });
        for (let i = 1; i < items.length - 1; i++) {
            parts.push({ type: "literal", value: this.#patterns.middle });
            parts.push({ type: "element", value: items[i] });
        }
        parts.push({ type: "literal", value: this.#patterns.end });
        parts.push({ type: "element", value: items[items.length - 1] });

        return parts;
    }

    resolvedOptions() {
        return { locale: "en-US", type: this.#type, style: this.#style };
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function ListFormat(locales, options) {
    return new ListFormatImpl(locales, options);
}
ListFormat.prototype = ListFormatImpl.prototype;
Object.defineProperty(ListFormat.prototype, "constructor", { value: ListFormat, writable: true, configurable: true });
ListFormat.supportedLocalesOf = ListFormatImpl.supportedLocalesOf;
Object.defineProperty(ListFormatImpl.prototype, Symbol.toStringTag, {
    value: "Intl.ListFormat", writable: false, enumerable: false, configurable: true
});

// ─── Segmenter ─────────────────────────────────────────────────────────────────

class SegmenterImpl {
    #granularity;

    constructor(locales, options) {
        const opts = options || {};
        this.#granularity = opts.granularity || "grapheme";

        if (!["grapheme", "word", "sentence"].includes(this.#granularity)) {
            throw new RangeError("Invalid granularity: " + this.#granularity);
        }
    }

    segment(string) {
        const str = String(string);
        const granularity = this.#granularity;
        // Call native segmentation — returns JSON array of [utf16_index, segment, isWordLike]
        const rawSegments = JSON.parse(intl_segment(str, granularity));
        return new Segments(str, rawSegments, granularity);
    }

    resolvedOptions() {
        return { locale: "en-US", granularity: this.#granularity };
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function Segmenter(locales, options) {
    return new SegmenterImpl(locales, options);
}
Segmenter.prototype = SegmenterImpl.prototype;
Object.defineProperty(Segmenter.prototype, "constructor", { value: Segmenter, writable: true, configurable: true });
Segmenter.supportedLocalesOf = SegmenterImpl.supportedLocalesOf;
Object.defineProperty(SegmenterImpl.prototype, Symbol.toStringTag, {
    value: "Intl.Segmenter", writable: false, enumerable: false, configurable: true
});

class Segments {
    #string;
    #segments;
    #granularity;

    constructor(string, segments, granularity) {
        this.#string = string;
        this.#segments = segments;
        this.#granularity = granularity;
    }

    containing(index) {
        const n = Math.trunc(Number(index));
        if (n < 0 || n >= this.#string.length) return undefined;

        // Find the segment containing this UTF-16 code unit index
        for (let i = 0; i < this.#segments.length; i++) {
            const [segStart, segStr] = this.#segments[i];
            const segEnd = segStart + segStr.length;  // length in UTF-16 code units
            if (n >= segStart && n < segEnd) {
                const result = { segment: segStr, index: segStart, input: this.#string };
                if (this.#granularity === "word") {
                    result.isWordLike = this.#segments[i][2];
                }
                return result;
            }
        }
        return undefined;
    }

    [Symbol.iterator]() {
        const segments = this.#segments;
        const string = this.#string;
        const granularity = this.#granularity;
        let i = 0;
        return {
            next() {
                if (i >= segments.length) {
                    return { value: undefined, done: true };
                }
                const [segStart, segStr, isWordLike] = segments[i++];
                const result = { segment: segStr, index: segStart, input: string };
                if (granularity === "word") {
                    result.isWordLike = isWordLike;
                }
                return { value: result, done: false };
            },
            [Symbol.iterator]() { return this; }
        };
    }
}

// ─── RelativeTimeFormat ────────────────────────────────────────────────────────

const RTF_UNITS = {
    long: { year: "year", quarter: "quarter", month: "month", week: "week", day: "day", hour: "hour", minute: "minute", second: "second" },
    short: { year: "yr.", quarter: "qtr.", month: "mo.", week: "wk.", day: "day", hour: "hr.", minute: "min.", second: "sec." },
    narrow: { year: "y.", quarter: "q.", month: "m.", week: "w.", day: "d.", hour: "h.", minute: "m.", second: "s." },
};

const RTF_AUTO = {
    year: { "-1": "last year", "1": "next year" },
    quarter: { "-1": "last quarter", "1": "next quarter" },
    month: { "-1": "last month", "1": "next month" },
    week: { "-1": "last week", "1": "next week" },
    day: { "-2": "2 days ago", "-1": "yesterday", "0": "today", "1": "tomorrow", "2": "in 2 days" },
    second: { "0": "now" },
};

const RTF_VALID_UNITS = ["year", "quarter", "month", "week", "day", "hour", "minute", "second"];

class RelativeTimeFormatImpl {
    #numeric;
    #style;

    constructor(locales, options) {
        const opts = options || {};
        this.#numeric = opts.numeric || "always";
        this.#style = opts.style || "long";

        if (!["always", "auto"].includes(this.#numeric)) {
            throw new RangeError("Invalid numeric value: " + this.#numeric);
        }
        if (!["long", "short", "narrow"].includes(this.#style)) {
            throw new RangeError("Invalid style: " + this.#style);
        }
    }

    format(value, unit) {
        return this.formatToParts(value, unit).map(p => p.value).join("");
    }

    formatToParts(value, unit) {
        const canonicalUnit = _rtfCanonicalUnit(String(unit));
        const n = Number(value);
        if (!Number.isFinite(n)) {
            throw new RangeError("Invalid value: " + value);
        }

        // numeric: "auto" — try special forms
        if (this.#numeric === "auto") {
            const autoMap = RTF_AUTO[canonicalUnit];
            if (autoMap) {
                const special = autoMap[String(n)];
                if (special !== undefined) {
                    return [{ type: "literal", value: special }];
                }
            }
        }

        // numeric formatting
        const absVal = Math.abs(n);
        const unitNames = RTF_UNITS[this.#style];
        const unitWord = unitNames[canonicalUnit];
        const pluralUnit = absVal === 1 ? unitWord : (this.#style === "long" ? canonicalUnit + "s" : unitWord);

        if (n < 0) {
            // past: "3 days ago"
            return [
                { type: "integer", value: String(absVal), unit: canonicalUnit },
                { type: "literal", value: " " + pluralUnit + " ago" },
            ];
        } else {
            // future: "in 3 days"
            return [
                { type: "literal", value: "in " },
                { type: "integer", value: String(absVal), unit: canonicalUnit },
                { type: "literal", value: " " + pluralUnit },
            ];
        }
    }

    resolvedOptions() {
        return { locale: "en-US", numeric: this.#numeric, style: this.#style, numberingSystem: "latn" };
    }

    static supportedLocalesOf() {
        return ["en-US"];
    }
}

function _rtfCanonicalUnit(unit) {
    // Accept both singular and plural forms
    let canonical = unit;
    if (canonical.endsWith("s")) {
        canonical = canonical.slice(0, -1);
    }
    if (!RTF_VALID_UNITS.includes(canonical)) {
        throw new RangeError("Invalid unit: " + unit);
    }
    return canonical;
}

function RelativeTimeFormat(locales, options) {
    return new RelativeTimeFormatImpl(locales, options);
}
RelativeTimeFormat.prototype = RelativeTimeFormatImpl.prototype;
Object.defineProperty(RelativeTimeFormat.prototype, "constructor", { value: RelativeTimeFormat, writable: true, configurable: true });
RelativeTimeFormat.supportedLocalesOf = RelativeTimeFormatImpl.supportedLocalesOf;
Object.defineProperty(RelativeTimeFormatImpl.prototype, Symbol.toStringTag, {
    value: "Intl.RelativeTimeFormat", writable: false, enumerable: false, configurable: true
});

// ─── Static helpers ────────────────────────────────────────────────────────────

function getCanonicalLocales(locales) {
    if (locales === undefined || locales === null) return [];
    const list = Array.isArray(locales) ? locales : [locales];
    if (list.length === 0) return [];
    return ["en-US"];
}

function supportedValuesOf(key) {
    switch (key) {
        case "calendar": return ["gregory"];
        case "collation": return ["default"];
        case "currency": return ["USD", "EUR", "GBP", "JPY", "CNY"];
        case "numberingSystem": return ["latn"];
        case "timeZone": return ["UTC"];
        case "unit": return [];
        default:
            throw new RangeError("Invalid key: " + key);
    }
}

// ─── Intl object ───────────────────────────────────────────────────────────────

const Intl = {
    DateTimeFormat,
    NumberFormat,
    Collator,
    PluralRules,
    ListFormat,
    Segmenter,
    getCanonicalLocales,
    supportedValuesOf,

    // Stubs for unsupported APIs
    RelativeTimeFormat,
    Locale: undefined,
    DisplayNames: undefined,
    DurationFormat: undefined,
};

// Polyfill String.prototype.localeCompare to delegate to Intl.Collator
// so that options like { numeric: true } are respected.
const _origLocaleCompare = String.prototype.localeCompare;
String.prototype.localeCompare = function(that, locales, options) {
    if (this == null) throw new TypeError("String.prototype.localeCompare called on null or undefined");
    if (arguments.length > 1) {
        return new CollatorImpl(locales, options).compare(String(this), String(that));
    }
    return _origLocaleCompare.call(this, that);
};

// Polyfill Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString
// to delegate to Intl.DateTimeFormat when options (especially timeZone) are provided.
// QuickJS's native implementations ignore the options parameter.
const _toLocaleDefaults = {
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
};
const _toLocaleDateDefaults = {
    year: "numeric", month: "numeric", day: "numeric",
};
const _toLocaleTimeDefaults = {
    hour: "numeric", minute: "2-digit", second: "2-digit",
};
const _dateTimeFields = ["year", "month", "day", "hour", "minute", "second",
    "weekday", "era", "timeZoneName", "dateStyle", "timeStyle"];

function _hasDateTimeFields(opts) {
    for (const k of _dateTimeFields) {
        if (opts[k] !== undefined) return true;
    }
    return false;
}

const _origToLocaleString = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function(locales, options) {
    if (options !== undefined && options !== null && typeof options === "object") {
        const opts = _hasDateTimeFields(options) ? options : { ..._toLocaleDefaults, ...options };
        return new DateTimeFormatImpl(locales, opts).format(this);
    }
    return _origToLocaleString.call(this);
};

const _origToLocaleDateString = Date.prototype.toLocaleDateString;
Date.prototype.toLocaleDateString = function(locales, options) {
    if (options !== undefined && options !== null && typeof options === "object") {
        const opts = _hasDateTimeFields(options) ? options : { ..._toLocaleDateDefaults, ...options };
        return new DateTimeFormatImpl(locales, opts).format(this);
    }
    return _origToLocaleDateString.call(this);
};

const _origToLocaleTimeString = Date.prototype.toLocaleTimeString;
Date.prototype.toLocaleTimeString = function(locales, options) {
    if (options !== undefined && options !== null && typeof options === "object") {
        const opts = _hasDateTimeFields(options) ? options : { ..._toLocaleTimeDefaults, ...options };
        return new DateTimeFormatImpl(locales, opts).format(this);
    }
    return _origToLocaleTimeString.call(this);
};

export { Intl };
export default Intl;
