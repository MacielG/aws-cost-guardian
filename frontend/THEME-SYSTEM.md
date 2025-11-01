# Sistema de Temas - AWS Cost Guardian

O AWS Cost Guardian implementa um sistema de temas completo que suporta modos claro e escuro, seguindo as melhores práticas de acessibilidade e design.

## Cores Base

### Tema Claro
- **Fundo:** Branco puro
- **Texto:** Cinza muito escuro (quase preto)
- **Primária:** Azul escuro profissional
- **Secundária:** Azul médio vibrante
- **Muted:** Tons suaves de cinza
- **Bordas:** Cinza muito claro

### Tema Escuro
- **Fundo:** Azul escuro profundo
- **Texto:** Branco suave
- **Primária:** Azul vibrante
- **Secundária:** Azul claro elétrico
- **Muted:** Tons escuros de cinza
- **Bordas:** Cinza muito escuro

## Efeitos e Animações

- **Card Hover:** Elevação suave com sombra adaptativa
- **Neon Effects:** Brilho e sombras adaptados para cada tema
- **Shimmer Effect:** Gradiente suave que respeita o tema atual
- **Scrollbar:** Design personalizado com cores temáticas

## Acessibilidade

- Alto contraste em ambos os temas
- Transições suaves para reduzir fadiga visual
- Textos legíveis com espaçamento adequado
- Indicadores visuais consistentes

## Implementação Técnica

Os temas são implementados usando CSS Variables (custom properties) e classes utilitárias do Tailwind CSS. A alternância entre temas é controlada pela classe `dark` no elemento HTML.