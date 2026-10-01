import {
  Calculator,
  CalendarDays,
  Gem,
  LayoutDashboard,
  BookOpen,
  SquarePen,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export type SectionDefinition = {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
};

export const sections = {
  dashboard: {
    title: "Pulpit",
    href: "/",
    description: "Tutaj pojawi się przegląd najważniejszych spraw Twojej pracowni.",
    icon: LayoutDashboard,
  },
  calculator: { title: "Kalkulator", href: "/kalkulator", description: "Szybka kalkulacja ceny i czystego zysku.", icon: Calculator },
  newQuote: {
    title: "Nowa wycena",
    href: "/nowa-wycena",
    description: "Tutaj powstanie miejsce do przygotowywania nowych wycen.",
    icon: SquarePen,
  },
  projects: {
    title: "Realizacje",
    href: "/realizacje",
    description: "Tutaj pojawią się realizacje prowadzone w Twojej pracowni.",
    icon: Gem,
  },
  calendar: {
    title: "Kalendarz",
    href: "/kalendarz",
    description: "Tutaj znajdziesz miejsce na terminy i plan pracy pracowni.",
    icon: CalendarDays,
  },
  clients: {
    title: "Klienci",
    href: "/klienci",
    description: "Tutaj powstanie przestrzeń na informacje o Twoich klientach.",
    icon: UsersRound,
  },
  settings: {
    title: "Baza wiedzy",
    href: "/cenniki-i-ustawienia",
    description: "Ręcznie uzupełniana baza kamieni i wyrobów referencyjnych.",
    icon: BookOpen,
  },
} as const satisfies Record<string, SectionDefinition>;

export const navigationItems = Object.values(sections);
