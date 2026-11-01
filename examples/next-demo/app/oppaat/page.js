export default function Guides() {
  return (
    <main>
      <h1>Oppaat</h1>
      {Array.from({ length: 30 }, (_, i) => (
        <p key={i}>Pitkä opas, kappale {i + 1}. Vieritä alas, niin vierityssyvyys näkyy sisältömoduulissa.</p>
      ))}
    </main>
  );
}
