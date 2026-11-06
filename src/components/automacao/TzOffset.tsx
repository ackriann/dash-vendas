"use client";
import { useEffect, useState } from "react";

/** Fuso do navegador (minutos), para o servidor entender o horário digitado. */
export default function TzOffset({ name = "tz_offset" }: { name?: string }) {
  const [v, setV] = useState("0");
  useEffect(() => setV(String(new Date().getTimezoneOffset())), []);
  return <input type="hidden" name={name} value={v} />;
}
