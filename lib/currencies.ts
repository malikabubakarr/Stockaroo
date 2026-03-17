import currencyCodes from "currency-codes";

export interface CurrencyOption {
  symbol: string;
  code: string;
  name: string;
  flag: string;
}

export const currencies: CurrencyOption[] = currencyCodes.data.map((c) => ({
  code: c.code,
  name: c.currency,
  symbol: c.code,
  flag: "🌍",
}));