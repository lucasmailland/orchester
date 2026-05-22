/**
 * Librería de fórmulas tipo Excel, categorizada y en español, para el nodo
 * "Planilla". Los nombres coinciden con @formulajs/formulajs (en inglés) — son
 * los que entiende el motor. Cada entrada trae sintaxis + descripción simple.
 */

export interface FormulaDef {
  name: string;
  syntax: string;
  desc: string;
}

export interface FormulaCategory {
  id: string;
  label: string;
  emoji: string;
  formulas: FormulaDef[];
}

export const FORMULA_LIBRARY: FormulaCategory[] = [
  {
    id: "math",
    label: "Matemática",
    emoji: "➕",
    formulas: [
      { name: "SUM", syntax: "SUM(A1:A5)", desc: "Suma todos los números." },
      { name: "AVERAGE", syntax: "AVERAGE(A1:A5)", desc: "Promedio de los números." },
      { name: "ROUND", syntax: "ROUND(A1, 2)", desc: "Redondea a N decimales." },
      { name: "ROUNDUP", syntax: "ROUNDUP(A1, 0)", desc: "Redondea hacia arriba." },
      { name: "ROUNDDOWN", syntax: "ROUNDDOWN(A1, 0)", desc: "Redondea hacia abajo." },
      { name: "ABS", syntax: "ABS(A1)", desc: "Valor absoluto (sin signo)." },
      { name: "MIN", syntax: "MIN(A1:A5)", desc: "El número más chico." },
      { name: "MAX", syntax: "MAX(A1:A5)", desc: "El número más grande." },
      { name: "PRODUCT", syntax: "PRODUCT(A1:A5)", desc: "Multiplica todos los números." },
      { name: "SQRT", syntax: "SQRT(A1)", desc: "Raíz cuadrada." },
      { name: "POWER", syntax: "POWER(A1, 2)", desc: "Eleva a una potencia." },
      { name: "MOD", syntax: "MOD(A1, 2)", desc: "Resto de una división." },
      { name: "INT", syntax: "INT(A1)", desc: "Parte entera del número." },
      { name: "CEILING", syntax: "CEILING(A1, 1)", desc: "Redondea al múltiplo superior." },
      { name: "FLOOR", syntax: "FLOOR(A1, 1)", desc: "Redondea al múltiplo inferior." },
      { name: "SUMPRODUCT", syntax: "SUMPRODUCT(A1:A3, B1:B3)", desc: "Suma de productos." },
    ],
  },
  {
    id: "logic",
    label: "Lógica",
    emoji: "🔀",
    formulas: [
      { name: "IF", syntax: 'IF(A1>10, "alto", "bajo")', desc: "Devuelve una cosa u otra según una condición." },
      { name: "AND", syntax: "AND(A1>0, B1>0)", desc: "Verdadero si TODAS se cumplen." },
      { name: "OR", syntax: "OR(A1>0, B1>0)", desc: "Verdadero si ALGUNA se cumple." },
      { name: "NOT", syntax: "NOT(A1>0)", desc: "Invierte verdadero/falso." },
      { name: "IFERROR", syntax: 'IFERROR(A1/B1, 0)', desc: "Usa un valor por defecto si hay error." },
      { name: "IFS", syntax: 'IFS(A1>10,"alto",A1>5,"medio")', desc: "Varias condiciones en orden." },
    ],
  },
  {
    id: "text",
    label: "Texto",
    emoji: "✍️",
    formulas: [
      { name: "CONCATENATE", syntax: 'CONCATENATE(A1, " ", B1)', desc: "Une textos." },
      { name: "LEFT", syntax: "LEFT(A1, 3)", desc: "Primeros N caracteres." },
      { name: "RIGHT", syntax: "RIGHT(A1, 3)", desc: "Últimos N caracteres." },
      { name: "MID", syntax: "MID(A1, 2, 4)", desc: "Caracteres del medio." },
      { name: "LEN", syntax: "LEN(A1)", desc: "Cantidad de caracteres." },
      { name: "UPPER", syntax: "UPPER(A1)", desc: "Pasa a MAYÚSCULAS." },
      { name: "LOWER", syntax: "LOWER(A1)", desc: "Pasa a minúsculas." },
      { name: "PROPER", syntax: "PROPER(A1)", desc: "Primera Letra En Mayúscula." },
      { name: "TRIM", syntax: "TRIM(A1)", desc: "Saca espacios de más." },
      { name: "SUBSTITUTE", syntax: 'SUBSTITUTE(A1, "a", "b")', desc: "Reemplaza un texto por otro." },
    ],
  },
  {
    id: "lookup",
    label: "Búsqueda",
    emoji: "🔎",
    formulas: [
      { name: "VLOOKUP", syntax: "VLOOKUP(A1, B1:C5, 2)", desc: "Busca un valor en una tabla (vertical)." },
      { name: "HLOOKUP", syntax: "HLOOKUP(A1, B1:E2, 2)", desc: "Busca un valor en una tabla (horizontal)." },
      { name: "INDEX", syntax: "INDEX(A1:A5, 2)", desc: "Trae el valor en una posición." },
      { name: "MATCH", syntax: "MATCH(A1, B1:B5, 0)", desc: "Posición de un valor en una lista." },
      { name: "CHOOSE", syntax: 'CHOOSE(A1, "a", "b", "c")', desc: "Elige una opción por número." },
    ],
  },
  {
    id: "date",
    label: "Fecha",
    emoji: "📅",
    formulas: [
      { name: "TODAY", syntax: "TODAY()", desc: "La fecha de hoy." },
      { name: "NOW", syntax: "NOW()", desc: "Fecha y hora actuales." },
      { name: "DATE", syntax: "DATE(2026, 5, 22)", desc: "Arma una fecha." },
      { name: "YEAR", syntax: "YEAR(A1)", desc: "El año de una fecha." },
      { name: "MONTH", syntax: "MONTH(A1)", desc: "El mes de una fecha." },
      { name: "DAY", syntax: "DAY(A1)", desc: "El día de una fecha." },
      { name: "WEEKDAY", syntax: "WEEKDAY(A1)", desc: "Día de la semana (número)." },
    ],
  },
  {
    id: "stats",
    label: "Estadística",
    emoji: "📊",
    formulas: [
      { name: "COUNT", syntax: "COUNT(A1:A5)", desc: "Cuenta cuántos números hay." },
      { name: "COUNTA", syntax: "COUNTA(A1:A5)", desc: "Cuenta celdas no vacías." },
      { name: "COUNTIF", syntax: 'COUNTIF(A1:A5, ">10")', desc: "Cuenta las que cumplen una condición." },
      { name: "MEDIAN", syntax: "MEDIAN(A1:A5)", desc: "El valor del medio." },
      { name: "STDEV", syntax: "STDEV(A1:A5)", desc: "Desviación estándar." },
      { name: "LARGE", syntax: "LARGE(A1:A5, 2)", desc: "El N-ésimo más grande." },
      { name: "SMALL", syntax: "SMALL(A1:A5, 2)", desc: "El N-ésimo más chico." },
    ],
  },
  {
    id: "finance",
    label: "Financiera",
    emoji: "💰",
    formulas: [
      { name: "PMT", syntax: "PMT(0.05/12, 60, 10000)", desc: "Cuota de un préstamo." },
      { name: "FV", syntax: "FV(0.05/12, 60, -100)", desc: "Valor futuro de una inversión." },
      { name: "PV", syntax: "PV(0.05/12, 60, -100)", desc: "Valor presente." },
      { name: "NPV", syntax: "NPV(0.1, A1:A5)", desc: "Valor actual neto." },
      { name: "IRR", syntax: "IRR(A1:A5)", desc: "Tasa interna de retorno." },
    ],
  },
];
