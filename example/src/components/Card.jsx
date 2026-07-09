export default function Card({ title, children }) {
  return (
    <section
      className="card"
      style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '16px 0' }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  )
}
