import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem isto, um componente montado num teste continua no documento durante o
// próximo, e consultas por papel passam a encontrar dois elementos.
afterEach(cleanup);
