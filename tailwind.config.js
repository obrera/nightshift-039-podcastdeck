/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#08111f',
        mist: '#dbe7ff',
        signal: '#7dd3fc',
        ember: '#fb7185',
        moss: '#86efac'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(125, 211, 252, 0.18), 0 20px 60px rgba(8, 17, 31, 0.45)'
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        display: ['"Sora"', '"Space Grotesk"', 'system-ui', 'sans-serif']
      },
      backgroundImage: {
        grain:
          'radial-gradient(circle at top, rgba(125, 211, 252, 0.14), transparent 38%), linear-gradient(135deg, rgba(251, 113, 133, 0.08), transparent 30%), linear-gradient(180deg, #08111f 0%, #0d1729 100%)'
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      },
      animation: {
        rise: 'rise 500ms ease-out both'
      }
    }
  },
  plugins: [],
};
