import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useProductStore = create(
   persist( 
  (set) => ({
  ItemId: "", 
  AllProducts: [],
  productObj: {},

  modifyProductsObj: (productObj) => set({ productObj }),
  modifyProductsArray: (AllProducts) => set({ AllProducts }),
  modifyProductsId: (ItemId) => set({ ItemId}),
}),
{
    name: 'product-store'
})
)



// useProductStore.persist.clearStorage();