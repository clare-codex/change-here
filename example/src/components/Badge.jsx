import { memo, forwardRef } from 'react'

export const Badge = memo(function Badge({ label }) {
  return <em className="badge">{label}</em>
})

export const Chip = memo(({ text }) => <i className="chip">{text}</i>)

export const FancyInput = memo(
  forwardRef(function FancyInput(props, ref) {
    return <input ref={ref} placeholder="forwardRef 输入框" {...props} />
  })
)
