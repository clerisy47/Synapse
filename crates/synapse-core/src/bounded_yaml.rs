//! Bounded YAML values prevent aliases from amplifying metadata allocations.
use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_yaml_ng::{Mapping, Value};
use std::fmt;
pub const MAX_METADATA_BYTES: usize = 16 * 1024;
const MAX_NODES: usize = 2048;
const MAX_OWNED_BYTES: usize = 64 * 1024;
const MAX_DEPTH: usize = 64;
struct Budget {
    nodes: usize,
    bytes: usize,
}
struct Seed<'a> {
    budget: &'a mut Budget,
    depth: usize,
}
impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Value;
    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        if self.depth > MAX_DEPTH || self.budget.nodes == 0 {
            return Err(de::Error::custom("metadata_budget"));
        }
        self.budget.nodes -= 1;
        deserializer.deserialize_any(self)
    }
}
impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Value;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("bounded metadata")
    }
    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        self.budget.bytes = self
            .budget
            .bytes
            .checked_sub(value.len())
            .ok_or_else(|| de::Error::custom("metadata_budget"))?;
        Ok(Value::String(value.to_owned()))
    }
    fn visit_string<E: de::Error>(self, value: String) -> Result<Value, E> {
        self.budget.bytes = self
            .budget
            .bytes
            .checked_sub(value.len())
            .ok_or_else(|| de::Error::custom("metadata_budget"))?;
        Ok(Value::String(value))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(Seed {
            budget: &mut *self.budget,
            depth: self.depth + 1,
        })? {
            values.push(value);
        }
        Ok(Value::Sequence(values))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut values = Mapping::new();
        while let Some(key) = map.next_key_seed(Seed {
            budget: &mut *self.budget,
            depth: self.depth + 1,
        })? {
            let value = map.next_value_seed(Seed {
                budget: &mut *self.budget,
                depth: self.depth + 1,
            })?;
            if values.insert(key, value).is_some() {
                return Err(de::Error::custom("duplicate_metadata_key"));
            }
        }
        Ok(Value::Mapping(values))
    }
}
pub fn parse(input: &str) -> Option<Value> {
    if input.len() > MAX_METADATA_BYTES {
        return None;
    }
    let mut budget = Budget {
        nodes: MAX_NODES,
        bytes: MAX_OWNED_BYTES,
    };
    Seed {
        budget: &mut budget,
        depth: 0,
    }
    .deserialize(serde_yaml_ng::Deserializer::from_str(input))
    .ok()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_alias_amplification_and_preserves_small_aliases() {
        assert!(parse("a: &a [one, two]\nb: *a").is_some());
        let mut input = "a: &a [one, two]\n".to_owned();
        for (previous, next) in [('a', 'b'), ('b', 'c'), ('c', 'd'), ('d', 'e'), ('e', 'f')] {
            input.push_str(&format!(
                "{next}: &{next} [{}]\n",
                std::iter::repeat_n(format!("*{previous}"), 10)
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
        assert!(parse(&input).is_none());
        assert!(parse("a: one\na: two").is_none());
    }
}
